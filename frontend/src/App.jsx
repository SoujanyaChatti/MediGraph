import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { fallbackFindingSummary } from './utils/consumerCopy.js';
import PatientPanel from './components/PatientPanel.jsx';
import GraphPanel from './components/GraphPanel.jsx';
import AgentPanel from './components/AgentPanel.jsx';

const DEMO_PATIENT = 'Sarah Chen';

export default function App() {
  const [serverOk, setServerOk] = useState(null);
  const [patient, setPatient] = useState(null);
  const [meds, setMeds] = useState([]);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  const refresh = useCallback(async (name = DEMO_PATIENT) => {
    const ms = await api.getMedications(name);
    setMeds(ms);
    setReportLoading(true);
    try {
      // get_report invokes the LLM per conflict; on cold runs this can take a second.
      const r = await api.getReport(name);
      setReport(r);
    } catch (e) {
      // get_report failing (LLM key missing, rate limit, etc.) should NOT break the UI —
      // fall back to the cheaper structural check.
      try {
        const c = await api.checkConflicts(name);
        setReport({
          patient_name: c.patient,
          overall_risk:
            c.conflict_count === 0
              ? 'safe'
              : c.conflicts.some((x) => x.severity === 'critical')
                ? 'danger'
                : c.conflicts.some((x) => x.severity === 'high')
                  ? 'warning'
                  : 'caution',
          total_drugs: c.drug_count,
          conflicts_found: c.conflict_count,
          findings: c.conflicts.map((x) => ({
            enzyme: x.enzyme,
            drugs: x.drugs,
            severity: x.severity,
            summary: fallbackFindingSummary(x),
            mechanism: x.enzyme
              ? `Both medications are processed through the ${x.enzyme} pathway in your liver.`
              : '',
            clinical_risk: 'Medication levels in your body may become unsafe.',
            recommendation:
              'Bring this report to your next appointment. Do not stop either medication on your own.',
          })),
          organ_risks: c.organ_risks,
        });
      } catch (_) {
        setReport(null);
      }
    } finally {
      setReportLoading(false);
    }
  }, []);

  // Boot: seed, ensure demo patient, fetch state.
  useEffect(() => {
    (async () => {
      try {
        await api.seed();
        await api.seedDemoPatient();
        const list = await api.listPatients();
        const p = list.find((x) => x.name === DEMO_PATIENT) ?? list[0];
        setPatient(p);
        setServerOk(true);
        await refresh(p.name);
      } catch (e) {
        setServerOk(false);
        setBootError(e.message);
      }
    })();
  }, [refresh]);

  async function resetDemo() {
    setBusy(true);
    try {
      await api.seedDemoPatient(); // resets Sarah Chen's meds
      await api.clearAgentMemory(DEMO_PATIENT);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runScript() {
    setBusy(true);
    try {
      await api.seedDemoPatient();
      await api.clearAgentMemory(DEMO_PATIENT);
      await api.addDrug(DEMO_PATIENT, 'Metoprolol', 50, 'once daily');
      await refresh();
      await sleep(500);
      await api.addDrug(DEMO_PATIENT, 'Simvastatin', 40, 'once daily');
      await refresh();
      await sleep(500);
      await api.addDrug(DEMO_PATIENT, 'Clarithromycin', 500, 'twice daily');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (serverOk === null) {
    return (
      <FullScreen>
        <div className="text-slate-400">Connecting to MediGraph backend…</div>
      </FullScreen>
    );
  }
  if (serverOk === false) {
    return (
      <FullScreen>
        <div className="max-w-md text-center space-y-3">
          <div className="text-2xl font-semibold text-red-300">Backend unreachable</div>
          <div className="text-sm text-slate-400">
            Start it with <code className="bg-slate-800 px-1.5 rounded">jac start main.jac</code> in the project root.
          </div>
          {bootError && <div className="text-xs text-red-400">{bootError}</div>}
        </div>
      </FullScreen>
    );
  }

  const hasConflict = (report?.conflicts_found ?? 0) > 0;

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🧬</div>
          <div>
            <div className="text-lg font-semibold tracking-tight">MediGraph</div>
            <div className="text-[11px] text-slate-400">
              Scan your medications for dangerous interactions before your next doctor visit
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reportLoading && (
            <span className="text-xs text-slate-400 italic mr-2">
              Checking your medications…
            </span>
          )}
          <button
            onClick={runScript}
            disabled={busy}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded px-3 py-1.5 text-sm font-medium"
          >
            ▶ Try demo (see a conflict)
          </button>
          <button
            onClick={resetDemo}
            disabled={busy}
            className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded px-3 py-1.5 text-sm"
          >
            Reset
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-[380px_1fr_420px]">
        <section className="border-r border-slate-800 min-h-0">
          {patient && (
            <PatientPanel
              patient={patient}
              meds={meds}
              report={report}
              busy={busy}
              onMedsChanged={() => refresh()}
            />
          )}
        </section>
        <section className="border-r border-slate-800 min-h-0">
          {patient && <GraphPanel patient={patient} meds={meds} report={report} />}
        </section>
        <section className="min-h-0">
          {patient && (
            <AgentPanel
              patient={patient}
              hasConflict={hasConflict}
              onAgentFinished={() => refresh()}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function FullScreen({ children }) {
  return <div className="h-screen flex items-center justify-center">{children}</div>;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
