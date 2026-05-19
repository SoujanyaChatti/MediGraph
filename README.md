# MediGraph

Graph-native medication safety intelligence in [Jac](https://www.jaseci.org/),
with an autonomous **PharmacistAgent** that plans and executes
multi-step tool use to resolve drug interactions.

The human body is modeled as a Jac graph — patients, drugs, enzymes, organs as
nodes; metabolic relationships as edges. Drug interactions are detected by
**walking the graph topology** (two drugs sharing an enzyme where one is an
inhibitor → structural conflict), not by consulting an interaction table.
Once a conflict fires, the PharmacistAgent walker takes over: it reads the
graph, picks tools, executes them, writes results back as nodes, and loops
until it has resolved the conflict or escalated to a human.

## What it does

- Models 15 commonly co-prescribed drugs and their CYP enzyme pathways
- Detects shared-pathway conflicts by **graph traversal** (no lookup table)
- Runs a **planning agent loop**: the LLM chooses one tool per step from a
  registry; tools fetch FDA labels, search the graph for alternatives,
  apply renal-dosing rules, or escalate
- The graph **IS the agent's memory** — every reasoning step, evidence pull,
  alternative, and dose recommendation is persisted as a node attached to
  the patient and replayable across sessions
- Generates pharmacist-grade narrative via byLLM (typed return = prompt)
- Exposes every walker as an auto-generated HTTP endpoint via `jac start`

## Tech stack

| Layer | Tool |
|---|---|
| Language | Jac (jaclang 0.10) |
| LLM | byLLM → Groq → `llama-3.3-70b-versatile` (typed return = prompt) |
| Tool I/O | OpenFDA drug label API (live) + in-graph search |
| Runtime / HTTP | `jac start` — walkers auto-exposed at `/walker/<name>` |
| Graph persistence | Jac built-in (SQLite under `.jac/data/`) |

## Setup

Requires **Python 3.12+** (jaclang uses `typing.override`).

```bash
python3.12 -m venv .venv
.venv/bin/pip install jaclang byllm python-dotenv

cp .env.example .env       # then put your GROQ_API_KEY in .env
```

## Run the CLI demo

```bash
.venv/bin/jac run main.jac
```

This seeds the enzyme/organ skeleton, creates patient Sarah Chen (68, GFR 55),
then walks through the four-step demo:

1. Add **Metoprolol** (CYP2D6) — no conflicts
2. Add **Simvastatin** (CYP3A4) — no conflicts
3. Add **Clarithromycin** (CYP3A4 inhibitor) — **CONFLICT** detected
4. **PharmacistAgent** plans a response — calls Groq, picks tools, executes

Sample agent transcript (real run):
```
step 0: [find_alternatives] Find alternatives because the current drug
        has a high severity conflict.
  -> drug_class: statin, candidates: [], no non-CYP3A4 statin in seed
step 1: [fetch_fda_label] fetch the FDA label for Clarithromycin
  -> OpenFDA call made
step 2: [compute_dose_adjustment] adjust Simvastatin for the interaction
  -> 40.0 mg -> 24.4 mg (GFR 55, scale 0.61)
step 3: [find_alternatives] retry alternatives, confirm none exist
step 4: [done] dose recommendation issued, stopping
```

> Graph state persists between runs in `.jac/data/medigraph.db`.
> Delete the file to start fresh.

## Run as an HTTP server

```bash
.venv/bin/jac start main.jac
```

Server boots at `http://localhost:8000` with auto-generated Swagger at `/docs`.

```bash
# Run the autonomous agent on a patient with a conflict
curl -X POST http://localhost:8000/walker/run_pharmacist_agent \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Sarah Chen","max_steps":6}'

# Replay everything the agent has ever attached to a patient
curl -X POST http://localhost:8000/walker/get_agent_memory \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Sarah Chen"}'

# Seed enzymes / organs (idempotent)
curl -X POST http://localhost:8000/walker/seed

# Create demo patient
curl -X POST http://localhost:8000/walker/seed_demo_patient

# Add a drug
curl -X POST http://localhost:8000/walker/add_drug \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Sarah Chen","drug_name":"Simvastatin","dose_mg":40,"frequency":"once daily"}'

# Structural conflict check (no LLM)
curl -X POST http://localhost:8000/walker/check_conflicts \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Sarah Chen"}'

# Full clinical report (LLM-generated explanations)
curl -X POST http://localhost:8000/walker/get_report \
  -H 'Content-Type: application/json' \
  -d '{"patient_name":"Sarah Chen"}'
```

## Walker reference

| Walker | Purpose |
|---|---|
| `seed` | Build enzyme + organ skeleton (idempotent) |
| `seed_demo_patient` | Create Sarah Chen, reset her medications |
| `create_patient` | Add an arbitrary patient |
| `list_patients` | List all patients |
| `add_drug` | Add a drug; wires it to enzyme + organ nodes |
| `remove_drug` | Detach + delete a drug node |
| `get_medications` | List a patient's current drugs |
| `check_conflicts` | Pure structural traversal — no LLM call |
| `get_report` | Full safety report with `by llm()` explanations |
| **`run_pharmacist_agent`** | **Autonomous planning loop — picks tools, executes, persists** |
| `get_agent_memory` | Read back everything the agent attached to a patient |
| `clear_agent_memory` | Wipe agent history for a clean demo |

## The PharmacistAgent

A planning walker that closes the loop between structural conflict detection
and clinical action. Each iteration:

1. Builds an `AgentState` summary from current graph state (patient profile,
   detected conflict, what's already been tried)
2. Calls `choose_next_action(state) -> AgentAction by llm()` — Groq picks
   one tool plus a thought
3. Dispatches to the chosen tool (a pure Jac function)
4. The tool **writes results back as nodes** attached to the patient:
   `Evidence`, `Alternative`, `DoseRecommendation`, `Escalation`, `Reasoning`
5. Loops with the updated state, up to `max_steps` (default 6) or until the
   LLM emits `done`

### Tool registry

| Tool | Effect |
|---|---|
| `fetch_fda_label(drug)` | Live OpenFDA call; attaches `Evidence` node |
| `find_alternatives(drug_class)` | Graph search for same-class drugs that avoid the conflicting enzyme; attaches `Alternative` |
| `compute_dose_adjustment(drug)` | Renal-dosing rule using patient GFR; attaches `DoseRecommendation` |
| `escalate(reason)` | Flags for human pharmacist review; attaches `Escalation` |
| `done(final_summary)` | Terminates the loop |

### Why this is agentic, not just "LLM in a walker"

- **Planning:** the LLM chooses each next step from a fixed action space
- **Tool use:** real I/O — OpenFDA HTTP, graph queries, computation
- **Memory:** the graph itself; `get_agent_memory` replays past runs
- **Multi-step:** observed 4-step plans with course-correction (e.g.
  retried `find_alternatives` after the first attempt found nothing)
- **Self-termination:** the agent emits `done` when its own state says the
  goal is met

## The Jac advantage

- **Graph topology = clinical reasoning.** `check_conflicts` doesn't query a
  table — it walks `Drug --MetabolizedBy--> Enzyme <--MetabolizedBy-- Drug` and
  reports any case where one neighbor is an inhibitor. New drugs slot into the
  same logic with no code change.
- **`by llm()` replaces prompt engineering.** `explain_interaction` is a
  function signature with `sem` annotations — the LLM is steered by types, not
  a hand-written prompt template.
- **One file, full backend.** Every walker in `main.jac` is reachable over HTTP
  the instant `jac start` runs. No FastAPI glue, no route declarations.

## Graph model

```
Root
 ├── Registry (seeded flag)
 ├── Patient ─Prescribed→ Drug ─MetabolizedBy→ Enzyme ─EnzymeIn→ Organ
 │                          └─AffectsOrgan(mechanism, severity)→ Organ
 ├── Enzyme (CYP3A4, CYP2C9, CYP2D6, CYP2C19, CYP1A2, P-glycoprotein)
 └── Organ (Liver, Kidney, Heart, CNS, Thyroid)
```

## Drugs in the seed set

Warfarin · Fluconazole · Clarithromycin · Azithromycin · Metoprolol · Amiodarone ·
Simvastatin · Sertraline · Omeprazole · Clopidogrel · Digoxin · Rifampin ·
Carbamazepine · Tacrolimus · Ciprofloxacin

## What's next

- Patient-specific pharmacogenomics (CYP2D6/2C19 polymorphism nodes)
- OpenFDA enrichment for drugs outside the seed set
- A jac-client frontend (three-panel UI per the original PRD)
- Dosing-adjustment walker that proposes safe alternatives when conflicts fire

## Frontend

A three-panel React app lives in `frontend/`:

- **Left:** patient header (risk-colored banner), add-medication form, current
  meds, byLLM-narrated findings, organ-risk heatmap
- **Middle:** live `react-flow` visualization of the graph — Patient → Drugs →
  Enzymes → Organs. Conflict enzymes turn red and the edges animate.
- **Right:** PharmacistAgent panel with a streaming transcript view —
  each tool call appears as a step card with its thought, tool, and result.

### Run the full stack

```bash
# Terminal 1 — backend
.venv/bin/jac start main.jac

# Terminal 2 — frontend
cd frontend
npm install      # first time only
npm run dev      # → http://localhost:5173
```

Open the URL, click **▶ Run demo script** to auto-play the
Metoprolol → Simvastatin → Clarithromycin sequence, then click **Run agent**
to watch the PharmacistAgent plan its response in real time.

### How the auth works (and why the UI does it transparently)

`jac start` creates a per-user persistent graph. To keep state shared across
requests in the demo, the frontend registers + logs in a `demo` user on first
load and attaches `Authorization: Bearer <token>` to every walker call. No
manual login needed; it's automatic.

## Project layout

```
medigraph/
├── main.jac                  ← entire backend (nodes, edges, walkers, agent, byLLM)
├── jac.toml                  ← project config
├── .env.example              ← copy to .env, fill in GROQ_API_KEY
├── frontend/
│   ├── src/
│   │   ├── App.jsx           ← three-panel shell + demo-script driver
│   │   ├── api.js            ← walker client + auto-auth
│   │   └── components/
│   │       ├── PatientPanel.jsx
│   │       ├── GraphPanel.jsx   ← react-flow visualization
│   │       └── AgentPanel.jsx   ← agent transcript view
│   ├── package.json
│   └── vite.config.js
└── README.md
```
