const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const DEMO_USER = { username: 'demo', password: 'demo1234' };

let token = null;
let authPromise = null;

async function http(path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(`${path} → ${msg}`);
  }
  return json;
}

async function ensureAuth() {
  if (token) return token;
  if (authPromise) return authPromise;
  authPromise = (async () => {
    // Try login; if 401-like, register then login.
    const tryLogin = async () => {
      const r = await fetch(`${BASE}/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: { type: 'username', value: DEMO_USER.username },
          credential: { type: 'password', password: DEMO_USER.password },
        }),
      });
      const j = await r.json().catch(() => ({}));
      return j?.data?.token || null;
    };
    let t = await tryLogin();
    if (!t) {
      // Register, ignore failure (likely already exists), then login.
      await fetch(`${BASE}/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identities: [{ type: 'username', value: DEMO_USER.username }],
          credential: { type: 'password', password: DEMO_USER.password },
        }),
      }).catch(() => {});
      t = await tryLogin();
    }
    if (!t) throw new Error('could not authenticate demo user');
    token = t;
    return token;
  })();
  return authPromise;
}

async function call(walker, body = {}) {
  await ensureAuth();
  const json = await http(`/walker/${walker}`, body);
  if (json.error) throw new Error(`${walker} → ${json.error}`);
  return json.data?.reports ?? [];
}

export const api = {
  ensureAuth,
  seed: () => call('seed'),
  seedDemoPatient: () => call('seed_demo_patient'),
  listPatients: () => call('list_patients').then(r => r[0] ?? []),
  getMedications: (patient_name) =>
    call('get_medications', { patient_name }).then(r => r[0] ?? []),
  addDrug: (patient_name, drug_name, dose_mg, frequency) =>
    call('add_drug', { patient_name, drug_name, dose_mg, frequency }).then(r => r[0]),
  removeDrug: (patient_name, drug_name) =>
    call('remove_drug', { patient_name, drug_name }).then(r => r[0]),
  checkConflicts: (patient_name) =>
    call('check_conflicts', { patient_name }).then(r => r[0]),
  getReport: (patient_name) =>
    call('get_report', { patient_name }).then(r => r[0]),
  runAgent: (patient_name, max_steps = 6) =>
    call('run_pharmacist_agent', { patient_name, max_steps }).then(r => r[0]),
  getAgentMemory: (patient_name) =>
    call('get_agent_memory', { patient_name }).then(r => r[0] ?? []),
  clearAgentMemory: (patient_name) =>
    call('clear_agent_memory', { patient_name }).then(r => r[0]),
  runCritic: (patient_name) =>
    call('run_safety_critic', { patient_name }).then(r => r[0]),
  getCriticMemory: (patient_name) =>
    call('get_critic_memory', { patient_name }).then(r => r[0] ?? []),
  clearCriticMemory: (patient_name) =>
    call('clear_critic_memory', { patient_name }).then(r => r[0]),
};

export const SEED_DRUGS = [
  'Warfarin', 'Fluconazole', 'Clarithromycin', 'Azithromycin', 'Metoprolol',
  'Amiodarone', 'Simvastatin', 'Sertraline', 'Omeprazole', 'Clopidogrel',
  'Digoxin', 'Rifampin', 'Carbamazepine', 'Tacrolimus', 'Ciprofloxacin',
];
