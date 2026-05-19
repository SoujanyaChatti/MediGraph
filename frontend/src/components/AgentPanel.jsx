import { useState } from 'react';
import { api } from '../api.js';

const TOOL_ICON = {
  fetch_fda_label: '📄',
  find_alternatives: '🔎',
  compute_dose_adjustment: '⚖️',
  escalate: '🚨',
  done: '✅',
  '?': '❓',
};

const TOOL_COLOR = {
  fetch_fda_label: 'border-sky-500/40 bg-sky-500/10',
  find_alternatives: 'border-emerald-500/40 bg-emerald-500/10',
  compute_dose_adjustment: 'border-amber-500/40 bg-amber-500/10',
  escalate: 'border-red-500/40 bg-red-500/10',
  done: 'border-purple-500/40 bg-purple-500/10',
};

const VERDICT_STYLE = {
  agreed: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  partial_agreement: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  disagree: 'border-red-500/50 bg-red-500/10 text-red-200',
};

export default function AgentPanel({ patient, hasConflict, onAgentFinished }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [criticRunning, setCriticRunning] = useState(false);
  const [critic, setCritic] = useState(null);
  const [criticError, setCriticError] = useState(null);

  async function run() {
    setRunning(true);
    setResult(null);
    setError(null);
    setCritic(null);
    try {
      await api.clearAgentMemory(patient.name);
      await api.clearCriticMemory(patient.name);
      const r = await api.runAgent(patient.name, 6);
      setResult(r);
      onAgentFinished?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function runCriticOnly() {
    setCriticRunning(true);
    setCritic(null);
    setCriticError(null);
    try {
      await api.clearCriticMemory(patient.name);
      const c = await api.runCritic(patient.name);
      setCritic(c);
      onAgentFinished?.();
    } catch (e) {
      setCriticError(e.message);
    } finally {
      setCriticRunning(false);
    }
  }

  async function clear() {
    await api.clearAgentMemory(patient.name);
    await api.clearCriticMemory(patient.name);
    setResult(null);
    setCritic(null);
    onAgentFinished?.();
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      <div className="mb-3">
        <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">For clinicians &amp; judges</div>
        <p className="text-sm text-slate-300 mb-2">
          Patients use <strong>Share with my doctor</strong> on the left. Expand below for the agentic pharmacist demo.
        </p>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-xs text-sky-400 hover:text-sky-300 underline mb-2"
        >
          {showAdvanced ? 'Hide advanced AI review' : 'Show advanced AI review'}
        </button>
      </div>

      {showAdvanced && (
      <>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">AI pharmacist (demo)</div>
          <div className="text-sm text-slate-300">Plans and runs clinical tools to resolve conflicts (advanced).</div>
        </div>
        <div className="flex gap-2">
          {(result || critic) && (
            <button onClick={clear} className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1">clear</button>
          )}
          <button
            onClick={run}
            disabled={running || !hasConflict}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded px-3 py-1.5 text-sm font-medium"
            title={hasConflict ? 'Run the agent' : 'No conflict detected — nothing for the agent to plan around'}
          >
            {running ? 'Thinking…' : 'Run agent'}
          </button>
        </div>
      </div>

      {!hasConflict && !result && (
        <div className="text-sm text-slate-500 italic border border-dashed border-slate-700 rounded p-4">
          No conflict detected yet. Add interacting medications (e.g. Simvastatin + Clarithromycin) and the agent will be enabled.
        </div>
      )}

      {error && (
        <div className="text-sm text-red-300 border border-red-500/50 bg-red-500/10 rounded p-3 mb-2">{error}</div>
      )}

      {running && (
        <div className="text-sm text-slate-400 border border-slate-700 rounded p-3 mb-2 animate-pulse">
          Agent is planning… (Groq llama-3.3-70b is choosing the next tool)
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="border border-purple-500/40 bg-purple-500/10 rounded p-3">
            <div className="text-xs uppercase tracking-wider text-purple-200 mb-1">Target conflict</div>
            <div className="text-sm">
              {result.conflict.drugs.join(' ↔ ')} on{' '}
              <span className="font-semibold">{result.conflict.enzyme}</span> —{' '}
              <span className="uppercase">{result.conflict.severity}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              {result.steps_completed} step{result.steps_completed === 1 ? '' : 's'} executed
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Transcript</div>
            <ol className="space-y-2">
              {result.transcript.map((t) => {
                const tool = t.tool || '?';
                return (
                  <li key={t.step} className={`border rounded p-2 ${TOOL_COLOR[tool] ?? 'border-slate-700 bg-slate-800/50'}`}>
                    <div className="flex items-start gap-2">
                      <div className="text-lg leading-none">{TOOL_ICON[tool] ?? '⚙️'}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-slate-400">
                          step {t.step} · <span className="text-slate-200">{tool}</span>
                        </div>
                        <div className="text-sm mt-0.5">{t.thought}</div>
                        {t.tool_result && (
                          <pre className="text-[11px] text-slate-300 bg-slate-950/60 rounded p-2 mt-2 overflow-x-auto">
                            {JSON.stringify(t.tool_result, null, 2)}
                          </pre>
                        )}
                        {t.final_summary && (
                          <div className="text-sm italic text-purple-200 mt-1">{t.final_summary}</div>
                        )}
                        {t.error && <div className="text-xs text-red-300 mt-1">⚠ {t.error}</div>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          {result.dose_recommendations?.length > 0 && (
            <Section title="Dose recommendations">
              {result.dose_recommendations.map((d, i) => (
                <div key={i} className="border border-amber-500/40 bg-amber-500/10 rounded p-2 text-sm">
                  <div className="font-medium">{d.drug_name}: {d.original_dose_mg} mg → {d.recommended_dose_mg} mg</div>
                  <div className="text-xs text-slate-300 mt-1">{d.rationale}</div>
                </div>
              ))}
            </Section>
          )}

          {result.alternatives?.length > 0 && (
            <Section title="Alternatives proposed">
              {result.alternatives.map((a, i) => (
                <div key={i} className="border border-emerald-500/40 bg-emerald-500/10 rounded p-2 text-sm">
                  <div className="font-medium">{a.drug_name} (replaces {a.replaces})</div>
                  <div className="text-xs text-slate-300 mt-1">{a.rationale}</div>
                </div>
              ))}
            </Section>
          )}

          {result.evidence?.length > 0 && (
            <Section title="Evidence collected">
              {result.evidence.map((e, i) => (
                <div key={i} className="border border-sky-500/40 bg-sky-500/10 rounded p-2 text-sm">
                  <div className="font-medium">{e.source}: {e.drug}</div>
                  <div className="text-xs text-slate-300 mt-1 line-clamp-3">{e.summary}</div>
                </div>
              ))}
            </Section>
          )}

          {result.escalations?.length > 0 && (
            <Section title="Escalations">
              {result.escalations.map((e, i) => (
                <div key={i} className="border border-red-500/40 bg-red-500/10 rounded p-2 text-sm">⚠ {e.reason}</div>
              ))}
            </Section>
          )}

          {/* SafetyCritic section */}
          <div className="pt-3 border-t border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">SafetyCritic</div>
                <div className="text-xs text-slate-500">Second-opinion audit of the plan above.</div>
              </div>
              <button
                onClick={runCriticOnly}
                disabled={criticRunning}
                className="bg-rose-600 hover:bg-rose-500 disabled:opacity-40 rounded px-3 py-1 text-xs font-medium"
              >
                {criticRunning ? 'Auditing…' : 'Run critic'}
              </button>
            </div>

            {criticError && (
              <div className="text-xs text-red-300 border border-red-500/40 bg-red-500/10 rounded p-2 mb-2">{criticError}</div>
            )}
            {criticRunning && (
              <div className="text-xs text-slate-400 border border-slate-700 rounded p-2 animate-pulse">
                Auditing PharmacistAgent's plan against the graph…
              </div>
            )}

            {critic && <CriticView critic={critic} />}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

function CriticView({ critic }) {
  const verdict = critic.verdict?.overall_verdict ?? 'agreed';
  const verdictStyle = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.agreed;
  const audit = critic.audit ?? {};
  return (
    <div className="space-y-2">
      <div className={`border rounded p-2 ${verdictStyle}`}>
        <div className="text-xs uppercase tracking-wider opacity-80">Verdict</div>
        <div className="text-sm font-semibold uppercase">{verdict.replace('_', ' ')}</div>
        {critic.verdict?.summary && (
          <div className="text-xs mt-1 opacity-90">{critic.verdict.summary}</div>
        )}
        {critic.verdict?.recommendation && (
          <div className="text-xs mt-1 opacity-75">
            <span className="font-semibold">Recommendation:</span> {critic.verdict.recommendation}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="border border-slate-700 rounded p-2 bg-slate-900/50">
          <div className="text-xl font-bold text-slate-200">{audit.total_conflicts ?? 0}</div>
          <div className="text-slate-400">conflicts</div>
        </div>
        <div className="border border-emerald-700 rounded p-2 bg-emerald-900/20">
          <div className="text-xl font-bold text-emerald-300">{(audit.addressed ?? []).length}</div>
          <div className="text-emerald-400">addressed</div>
        </div>
        <div className="border border-red-700 rounded p-2 bg-red-900/20">
          <div className="text-xl font-bold text-red-300">{(audit.unaddressed ?? []).length}</div>
          <div className="text-red-400">missed</div>
        </div>
      </div>

      {(critic.verdict?.missed_conflicts ?? []).length > 0 && (
        <Section title="Missed by PharmacistAgent">
          {critic.verdict.missed_conflicts.map((m, i) => (
            <div key={i} className="border border-red-500/40 bg-red-500/10 rounded p-2 text-xs">⚠ {m}</div>
          ))}
        </Section>
      )}

      {(critic.verdict?.additional_concerns ?? []).length > 0 && (
        <Section title="Additional concerns">
          {critic.verdict.additional_concerns.map((c, i) => (
            <div key={i} className="border border-amber-500/40 bg-amber-500/10 rounded p-2 text-xs">{c}</div>
          ))}
        </Section>
      )}

      {(critic.verdict?.agreed_actions ?? []).length > 0 && (
        <Section title="Agreed with">
          {critic.verdict.agreed_actions.map((a, i) => (
            <div key={i} className="border border-emerald-500/40 bg-emerald-500/10 rounded p-2 text-xs">✓ {a}</div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
