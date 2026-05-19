/** Patient-friendly labels and fallback copy when the LLM is unavailable. */

export const RISK_LABEL = {
  safe: 'Looking good',
  caution: 'Worth discussing',
  warning: 'Needs attention',
  danger: 'Talk to your doctor soon',
};

export const SEV_LABEL = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
};

/** Build a plain-language summary from structural conflict data (no LLM). */
export function fallbackFindingSummary(conflict) {
  const drugs = conflict.drugs ?? [];
  const inhibitors = conflict.inhibitors ?? [];
  if (inhibitors.length && drugs.length >= 2) {
    const affected = drugs.filter((d) => !inhibitors.includes(d));
    const victim = affected[0] ?? drugs[1];
    const blocker = inhibitors[0];
    return (
      `⚠️ ${blocker} may change how your body handles ${victim}. `
      + 'Levels of this medication could become too high or too low. '
      + 'Ask your doctor to review this combination before you continue both medicines.'
    );
  }
  return (
    `⚠️ ${drugs.join(' and ')} may not work well together. `
    + 'Your doctor should review this combination at your next visit.'
  );
}
