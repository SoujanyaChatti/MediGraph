import { useState } from 'react';
import { api, SEED_DRUGS } from '../api.js';
import { downloadDoctorReport } from '../utils/reportPdf.js';
import { RISK_LABEL, SEV_LABEL } from '../utils/consumerCopy.js';

const RISK_STYLE = {
  safe: 'bg-emerald-500/20 border-emerald-500 text-emerald-300',
  caution: 'bg-amber-500/20 border-amber-500 text-amber-200',
  warning: 'bg-orange-500/20 border-orange-500 text-orange-200',
  danger: 'bg-red-500/20 border-red-500 text-red-200',
};

function FindingCard({ finding }) {
  const [showClinical, setShowClinical] = useState(false);
  const riskKey =
    finding.severity === 'critical' ? 'danger' :
    finding.severity === 'high' ? 'warning' :
    finding.severity === 'moderate' ? 'caution' : 'safe';

  const hasClinical = finding.mechanism || finding.clinical_risk || finding.enzyme;

  return (
    <li className={`border rounded-lg p-3 ${RISK_STYLE[riskKey]}`}>
      <div className="flex items-start gap-2">
        <span className="text-lg leading-none mt-0.5" aria-hidden>⚠️</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-sm font-semibold">
              {finding.drugs?.join(' + ')}
            </span>
            <span className="text-[10px] uppercase tracking-wide opacity-70 px-1.5 py-0.5 rounded bg-black/20">
              {SEV_LABEL[finding.severity] ?? finding.severity}
            </span>
          </div>
          <p className="text-sm leading-relaxed opacity-95">
            {finding.summary}
          </p>
          {finding.recommendation && (
            <p className="text-xs mt-2 opacity-90 border-t border-current/20 pt-2">
              <span className="font-semibold">What to do: </span>
              {finding.recommendation}
            </p>
          )}
          {hasClinical && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowClinical((v) => !v)}
                className="text-xs underline opacity-80 hover:opacity-100"
              >
                {showClinical ? 'Hide clinical details' : 'Clinical details (for your doctor)'}
              </button>
              {showClinical && (
                <div className="mt-2 text-xs space-y-1.5 opacity-85 bg-black/15 rounded p-2 border border-current/10">
                  {finding.enzyme && (
                    <p><span className="font-semibold">Pathway: </span>{finding.enzyme}</p>
                  )}
                  {finding.clinical_risk && (
                    <p><span className="font-semibold">Your risk: </span>{finding.clinical_risk}</p>
                  )}
                  {finding.mechanism && (
                    <p><span className="font-semibold">How it works: </span>{finding.mechanism}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function PatientPanel({
  patient, meds, report, onMedsChanged, busy,
}) {
  const [drug, setDrug] = useState('Metoprolol');
  const [dose, setDose] = useState(50);
  const [frequency, setFrequency] = useState('once daily');
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);

  const overall = report?.overall_risk ?? 'safe';
  const gfr = patient.kidney_gfr ?? patient.kidney_function_gfr;

  async function add() {
    setAdding(true);
    try {
      await api.addDrug(patient.name, drug, parseFloat(dose), frequency);
      await onMedsChanged();
    } catch (e) {
      alert(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function remove(name) {
    if (!confirm(`Remove ${name} from your list?`)) return;
    try {
      await api.removeDrug(patient.name, name);
      await onMedsChanged();
    } catch (e) {
      alert(e.message);
    }
  }

  function shareWithDoctor() {
    setSharing(true);
    try {
      downloadDoctorReport({ patient, meds, report });
    } catch (e) {
      alert(e.message || 'Could not create PDF');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="h-full flex flex-col gap-3 p-4 overflow-y-auto">
      <div className={`rounded-lg border-2 p-4 ${RISK_STYLE[overall]}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider opacity-70">Your profile</div>
            <div className="text-xl font-semibold">{patient.name}</div>
            <div className="text-xs opacity-80 mt-1">
              age {patient.age} · kidney function {gfr} mL/min · {meds.length} medication{meds.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider opacity-70">Safety check</div>
            <div className="text-lg font-bold">{RISK_LABEL[overall] ?? overall}</div>
            {report && (
              <div className="text-xs opacity-80">
                {report.conflicts_found ?? 0} possible issue{(report.conflicts_found ?? 0) === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>
      </div>

      {report && (
        <button
          type="button"
          onClick={shareWithDoctor}
          disabled={sharing || busy}
          className="w-full flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg shadow-sky-900/30"
        >
          <span aria-hidden>📄</span>
          {sharing ? 'Creating PDF…' : 'Share with my doctor'}
        </button>
      )}

      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Add a medication</div>
        <p className="text-[11px] text-slate-500 mb-2">
          Enter everything you take — prescriptions, vitamins, and over-the-counter.
        </p>
        <div className="grid grid-cols-[1fr_80px_auto] gap-2 mb-2">
          <select
            value={drug}
            onChange={(e) => setDrug(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
            disabled={busy || adding}
          >
            {SEED_DRUGS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input
            type="number"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
            placeholder="mg"
            disabled={busy || adding}
          />
          <button
            onClick={add}
            disabled={busy || adding}
            className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded px-3 py-1 text-sm font-medium"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        <input
          type="text"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
          placeholder="How often? (e.g. once daily)"
          disabled={busy || adding}
        />
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
          My medications ({meds.length})
        </div>
        {meds.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-2">Add your medications above to scan for interactions.</div>
        ) : (
          <ul className="space-y-2">
            {meds.map((m) => (
              <li key={m.name} className="flex items-center justify-between border border-slate-700/50 rounded p-2 bg-slate-800/40">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-slate-400">
                    {m.dose_mg} mg · {m.frequency}
                  </div>
                </div>
                <button
                  onClick={() => remove(m.name)}
                  className="text-xs text-red-400 hover:text-red-300 px-2"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {report && report.findings?.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
            Possible problems with your medications
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            Read this before your next appointment. This is not medical advice — always talk to your doctor.
          </p>
          <ul className="space-y-3">
            {report.findings.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </ul>
        </div>
      )}

      {report && (!report.findings || report.findings.length === 0) && meds.length > 0 && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-900/20 p-3 text-sm text-emerald-200">
          No dangerous combinations detected in our database for your current list. Keep your list updated and share it with your doctor regularly.
        </div>
      )}

      {report?.organ_risks?.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">How your meds may affect your body</div>
          <p className="text-[11px] text-slate-500 mb-2">Based on your medications and health profile.</p>
          <div className="grid grid-cols-5 gap-2">
            {report.organ_risks.map((o) => {
              const intensity = Math.min(1, o.risk_score);
              const bg = `rgba(239, 68, 68, ${0.15 + intensity * 0.65})`;
              return (
                <div
                  key={o.organ}
                  className="rounded border border-slate-700 text-center py-2"
                  style={{ background: bg }}
                  title={`Relative concern: ${(o.risk_score * 100).toFixed(0)}%`}
                >
                  <div className="text-xs font-medium">{o.organ}</div>
                  <div className="text-[10px] opacity-80">
                    {o.risk_score > 0.6 ? 'Higher' : o.risk_score > 0.3 ? 'Moderate' : o.risk_score > 0 ? 'Some' : 'Low'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-500 leading-relaxed px-1">
        MediGraph helps you spot medication interactions before your doctor visit. It does not replace professional medical advice.
      </p>
    </div>
  );
}
