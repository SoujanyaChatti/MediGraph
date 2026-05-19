# MediGraph — Product Requirements Document
## For Claude Code

> **Mission:** Build MediGraph, a graph-native medication safety intelligence system in Jac (Jaseci), for the JacHacks Spring hackathon. Deadline: May 19, 2026 5:00 PM EDT.
> 
> **Target prizes:** Agentic AI 1st ($600) + Healthcare 1st ($600) + Best Use of Jac ($300) + Best Demo ($200) = **$1,700**

---

## 1. Overview

MediGraph models the human body as a first-class Jac graph. Organs, enzyme pathways, and drugs are nodes. Metabolic relationships are edges. Three cooperating Jac walkers traverse this graph autonomously to detect dangerous drug interactions — not by looking up a static table, but by reasoning from the biochemical structure of the graph itself.

This is the core differentiator: **the graph topology IS the clinical reasoning**. Two drugs competing for the same CYP enzyme pathway creates a conflict structurally, before any LLM is called. `by llm()` is used only to generate the human-readable clinical explanation of the detected conflict.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Language | Jac (Jaseci) — `pip install jaseci` |
| AI integration | `by llm()` via byllm plugin (claude-sonnet-4-20250514) |
| Full-stack | `jac-client` plugin — backend + React frontend in one `.jac` file |
| Drug data | OpenFDA API (https://api.fda.gov/drug) as live fallback |
| Graph persistence | Jac's built-in graph persistence (root node, no external DB) |
| Deployment | `jac start main.jac` locally; Render.com for demo URL |

**Install:**
```bash
pip install jaseci
export ANTHROPIC_API_KEY="your-key-here"
```

**Run:**
```bash
jac start main.jac
```

**`jac.toml`** (place in project root):
```toml
[project]
name = "medigraph"

[dependencies.npm]
jac-client-node = "1.0.4"

[dependencies.npm.dev]
"@jac-client/dev-deps" = "1.0.0"

[serve]
base_route_app = "app"

[plugins.client]

[plugins.byllm.model]
default_model = "claude-sonnet-4-20250514"
```

---

## 3. Graph Data Model

This is the most important section. The graph structure must be designed carefully — it is the reasoning substrate.

### 3.1 Node Types

```jac
node Patient {
    has name: str;
    has age: int;
    has weight_kg: float;
    has kidney_function_gfr: float = 90.0;  # mL/min/1.73m², normal = 90+
    has liver_function_score: float = 1.0;  # 1.0 = normal, 0.5 = impaired
}

node Drug {
    has name: str;                          # e.g. "Warfarin"
    has generic_name: str;                  # e.g. "warfarin sodium"
    has drug_class: str;                    # e.g. "anticoagulant"
    has dose_mg: float;
    has frequency: str;                     # e.g. "once daily"
    has is_inhibitor: bool = False;         # inhibits the enzyme it uses
    has is_inducer: bool = False;           # induces/speeds up the enzyme
    has therapeutic_window: str;            # "narrow" | "wide"
    has half_life_hours: float;
}

node Enzyme {
    has name: str;                          # e.g. "CYP3A4"
    has organ: str;                         # e.g. "liver"
    has capacity: float = 1.0;             # 1.0 = full, reduced by inhibitors
}

node Organ {
    has name: str;                          # e.g. "Liver", "Kidney", "Heart"
    has system: str;                        # e.g. "hepatic", "renal", "cardiac"
    has risk_score: float = 0.0;           # 0.0-1.0, set by walker during traversal
}
```

### 3.2 Edge Types

```jac
edge MetabolizedBy {
    has primary: bool = True;              # is this the primary pathway?
    has percentage: float = 100.0;        # % metabolized via this route
}

edge AffectsOrgan {
    has mechanism: str;                    # e.g. "QT prolongation", "hepatotoxicity"
    has severity: str;                     # "mild" | "moderate" | "severe"
}

edge Prescribed {
    has start_date: str;
    has prescriber: str;
}
```

### 3.3 Seed Graph — Drug-Enzyme Relationships

Hardcode these 15 drugs and their enzyme/organ relationships on app startup. These cover the most clinically dangerous combinations and are publicly available data.

| Drug | Metabolized By | Inhibitor/Inducer? | Organ Risk |
|---|---|---|---|
| Warfarin | CYP2C9 | — | Liver (bleeding) |
| Fluconazole | CYP3A4, CYP2C9 | **Inhibitor** (both) | Liver |
| Clarithromycin | CYP3A4 | **Inhibitor** | Liver, Heart (QT) |
| Azithromycin | — (not CYP) | — | Heart (QT) |
| Metoprolol | CYP2D6 | — | Heart |
| Amiodarone | CYP2D6, CYP3A4 | **Inhibitor** (both) | Heart (QT), Thyroid |
| Simvastatin | CYP3A4 | — | Liver (myopathy) |
| Sertraline | CYP2D6 | **Inhibitor** (mild) | Liver |
| Omeprazole | CYP2C19 | **Inhibitor** | Liver |
| Clopidogrel | CYP2C19 | — | Liver, Cardiovascular |
| Digoxin | P-glycoprotein | — | Heart (narrow window) |
| Rifampin | CYP3A4, CYP2C9 | **Inducer** (both) | Liver |
| Carbamazepine | CYP3A4 | **Inducer** | Liver, CNS |
| Tacrolimus | CYP3A4 | — | Kidney (narrow window) |
| Ciprofloxacin | — | **Inhibitor** (CYP1A2) | Heart (QT), Kidney |

---

## 4. Walker Architecture — The Three Agents

This is the agentic core. Three walkers, each with a single responsibility, coordinated by the graph itself.

### 4.1 IngestionWalker

**Trigger:** User adds a new drug to a patient.

**Behavior:**
1. Starts at the `Patient` root node
2. Checks if the drug already exists in the graph (deduplication)
3. If not found locally, calls OpenFDA API to retrieve drug metadata
4. Creates a new `Drug` node
5. Connects `Patient --[Prescribed]--> Drug`
6. Looks up the enzyme/organ relationships from the seed data and creates edges: `Drug --[MetabolizedBy]--> Enzyme` and `Drug --[AffectsOrgan]--> Organ`
7. Hands off to `ConflictWalker` by spawning it on the same patient root

```jac
walker IngestionWalker {
    has drug_name: str;
    has dose_mg: float;
    has frequency: str;

    can ingest with Patient entry {
        # Check if drug already in graph
        existing = [-->](?:Drug)[0] if [-->](?:Drug) else None;
        if not existing {
            new_drug = Drug(
                name=self.drug_name,
                dose_mg=self.dose_mg,
                frequency=self.frequency
            );
            here ++> new_drug;
            # Connect to enzyme/organ nodes from seed data
            self.wire_drug_pathways(new_drug);
        }
        # Spawn conflict detection
        ConflictWalker() spawn here;
    }

    can wire_drug_pathways(drug: Drug) -> None {
        # Look up preloaded enzyme nodes, create edges
        # Also calls OpenFDA if drug not in seed data
        ...
    }
}
```

### 4.2 ConflictWalker

**Trigger:** Spawned automatically after any drug ingestion. Can also be triggered manually.

**Behavior:**
1. Starts at the `Patient` root
2. Visits all `Drug` nodes connected to this patient
3. For each drug, follows `MetabolizedBy` edges to `Enzyme` nodes
4. At each `Enzyme` node, checks: are there OTHER drugs from this patient also connected to this enzyme?
5. If yes AND one is an inhibitor/inducer → **conflict detected**
6. Follows `AffectsOrgan` edges and accumulates `risk_score` on `Organ` nodes
7. Builds a `ConflictReport` list — structured data, no LLM yet
8. Hands off to `ReportWalker` with the conflict list

```jac
walker ConflictWalker {
    has conflicts: list = [];

    can scan with Patient entry {
        visit [-->](?:Drug);
    }

    can check_drug with Drug entry {
        # Follow this drug's enzyme pathways
        visit [-->](?:Enzyme);
    }

    can detect_conflicts with Enzyme entry {
        # Find all patient's drugs sharing this enzyme
        patient_drugs_here = [<--](?:Drug);  # drugs pointing to this enzyme

        if len(patient_drugs_here) > 1 {
            # Check for inhibitor/inducer conflicts
            inhibitors = [d for d in patient_drugs_here if d.is_inhibitor];
            if inhibitors {
                self.conflicts.append({
                    "enzyme": here.name,
                    "drugs": [d.name for d in patient_drugs_here],
                    "inhibitor": inhibitors[0].name,
                    "severity": self.compute_severity(patient_drugs_here)
                });
            }
        }

        # Update organ risk scores
        visit [-->](?:Organ);
    }

    can update_organ_risk with Organ entry {
        # Accumulate risk score based on number of drugs affecting this organ
        # and their individual severity ratings
        here.risk_score = min(1.0, here.risk_score + 0.2);
    }
}
```

### 4.3 ReportWalker

**Trigger:** Called by `ConflictWalker` with a populated conflicts list.

**Behavior:**
1. Receives the structured conflict list from `ConflictWalker`
2. For each conflict, calls `by llm()` on a typed function to generate clinical narrative
3. Aggregates into a `SafetyReport` with overall risk level
4. Makes the report available to the frontend via a `def:pub` endpoint

```jac
walker ReportWalker {
    has conflicts: list;
    has report: SafetyReport = SafetyReport();

    can generate with Patient entry {
        for conflict in self.conflicts {
            explanation = explain_interaction(
                drug_a=conflict["drugs"][0],
                drug_b=conflict["drugs"][1],
                enzyme=conflict["enzyme"],
                severity=conflict["severity"],
                patient_age=here.age,
                kidney_gfr=here.kidney_function_gfr
            );
            self.report.add_finding(conflict, explanation);
        }
    }
}

# byLLM function — the ONLY place LLM is called
# The type signature IS the prompt. No prompt engineering needed.
def explain_interaction(
    drug_a: str,
    drug_b: str,
    enzyme: str,
    severity: str,
    patient_age: int,
    kidney_gfr: float
) -> ClinicalExplanation
    by llm();
```

---

## 5. Data Types

```jac
obj ClinicalExplanation {
    has summary: str;               # 1-sentence plain English summary
    has mechanism: str;             # What's happening biochemically
    has clinical_risk: str;         # What could go wrong for the patient
    has recommendation: str;        # What the clinician should consider
    has severity_level: str;        # "low" | "moderate" | "high" | "critical"
    has references: list[str];      # Drug names involved
}

obj SafetyReport {
    has patient_name: str;
    has overall_risk: str;          # "safe" | "caution" | "warning" | "danger"
    has total_drugs: int;
    has conflicts_found: int;
    has findings: list[dict];
    has generated_at: str;
}
```

---

## 6. API Endpoints (jac-client)

These are exposed automatically via `def:pub` in Jac. The frontend calls them.

```jac
# Add a drug to a patient's profile
def:pub add_drug(
    patient_id: str,
    drug_name: str,
    dose_mg: float,
    frequency: str
) -> SafetyReport { ... }

# Get full safety report for a patient
def:pub get_report(patient_id: str) -> SafetyReport { ... }

# Get all drugs for a patient
def:pub get_medications(patient_id: str) -> list[dict] { ... }

# Remove a drug
def:pub remove_drug(patient_id: str, drug_name: str) -> SafetyReport { ... }

# Get organ risk visualization data
def:pub get_organ_risks(patient_id: str) -> list[dict] { ... }

# Seed demo patient (for hackathon demo)
def:pub seed_demo_patient() -> str { ... }
```

---

## 7. Frontend (jac-client React component)

Single `cl def:pub app()` component in the same `.jac` file. Three panels:

### Panel 1 — Patient Header
- Patient name, age, kidney function displayed as badges
- Overall risk status banner: green (safe) / yellow (caution) / orange (warning) / red (danger)

### Panel 2 — Medication List
- Cards for each prescribed drug showing: name, dose, frequency, drug class
- "Add Medication" button → modal with drug name input + dose + frequency
- "Remove" button on each card
- On add: loading spinner while walkers run, then report updates

### Panel 3 — Risk Report
- If no conflicts: green checkmark + "No interactions detected"
- If conflicts: one card per conflict showing:
  - Drug A ↔ Drug B
  - Enzyme/pathway involved
  - Severity badge (color-coded)
  - `ClinicalExplanation.summary` in plain text
  - Expandable "Details" → mechanism + recommendation
- Organ risk heatmap: simple grid of organ names with color intensity based on `risk_score`

### Demo Flow (for the 3-minute hackathon video)
The app must support a "Load Demo" button that seeds this exact patient:

**Patient:** Sarah Chen, 68 years old, kidney GFR 55 (mildly reduced)

**Step 1:** Add Metoprolol 50mg once daily → no conflicts → green banner

**Step 2:** Add Simvastatin 40mg once daily → no conflicts → green banner  

**Step 3:** Add Clarithromycin 500mg twice daily → **CONFLICT DETECTED**
- Clarithromycin inhibits CYP3A4
- Simvastatin is metabolized by CYP3A4
- Risk: rhabdomyolysis (muscle breakdown) — "critical" severity
- Red banner fires immediately

**Step 4:** Add Azithromycin (after removing Clarithromycin) → different mechanism → different risk profile → show nuanced report

This four-step demo proves the system reasons from graph structure, not a lookup table.

---

## 8. OpenFDA Integration

For drugs not in the seed graph, call the OpenFDA API to retrieve interaction metadata.

```jac
import from requests { get as http_get }

def fetch_drug_from_fda(drug_name: str) -> dict {
    url = f"https://api.fda.gov/drug/label.json?search=openfda.brand_name:{drug_name}&limit=1";
    response = http_get(url);
    if response.status_code == 200 {
        data = response.json();
        # Extract: generic_name, drug_interactions field, warnings
        return parse_fda_response(data);
    }
    return {};
}
```

Use the `drug_interactions` field from the FDA label to identify enzymes and create edges dynamically. If FDA lookup fails, create the drug node with minimal data and flag it as "interaction data unavailable."

---

## 9. File Structure

```
medigraph/
├── jac.toml                    # Project config (see Section 2)
├── main.jac                    # ENTIRE APPLICATION — one file
│   ├── # Node/Edge definitions (Section 3)
│   ├── # Walker definitions (Section 4)
│   ├── # Data types (Section 5)
│   ├── # Public API endpoints (Section 6)
│   ├── # Frontend component (Section 7)
│   └── # Seed data initialization
├── seed_data.jac               # Drug-enzyme-organ seed graph builder
│   └── # Called once on startup to populate root graph
└── README.md                   # Devpost submission writeup
```

**Critical constraint:** Keep backend logic and frontend in `main.jac`. This is intentional — the single-file full-stack capability is a judging criterion for "Best Use of Jac."

---

## 10. Seed Data Initialization

On first run, `main.jac` must call an `init` function that:

1. Creates `Enzyme` nodes for: CYP3A4, CYP2C9, CYP2D6, CYP2C19, CYP1A2, P-glycoprotein
2. Creates `Organ` nodes for: Liver, Kidney, Heart, CNS, Thyroid
3. Connects enzymes to organs (e.g. CYP3A4 → Liver)
4. Creates a demo `Patient` node (Sarah Chen) with her 15 drugs for demo purposes
5. Wires all drug → enzyme → organ edges per the table in Section 3.3

Use a `has_been_seeded: bool` flag on root to avoid re-seeding on restart.

---

## 11. Error Handling

| Scenario | Behavior |
|---|---|
| OpenFDA API down | Use drug with no enzyme data; show "interaction data unavailable" warning |
| Drug not in seed data AND FDA miss | Still add drug to graph; ConflictWalker skips it for enzyme conflicts |
| LLM call fails | Show pre-written fallback: "Consult a pharmacist about this combination." |
| Duplicate drug add | Return existing drug's data; don't create duplicate node |
| Patient not found | Auto-create patient with provided ID and default values |

---

## 12. Devpost Submission Checklist

The README.md must include these exact sections to score on all judging criteria:

1. **What it does** — patient-facing: "MediGraph checks your medications for dangerous combinations in real time"
2. **How we built it** — technical: walker architecture, graph model, by llm() usage, jac-client full-stack
3. **The Jac advantage** — explicitly state: walkers traverse graph topology to detect conflicts structurally; `by llm()` replaces prompt engineering with type-inferred AI; `jac-client` delivers full-stack in one file
4. **Demo scenario** — describe the Clarithromycin + Simvastatin conflict detection step by step
5. **What's next** — patient-specific pharmacogenomics (CYP polymorphisms), EHR integration, dosing recommendations

**Demo video requirements:**
- Max 3 minutes
- Must show: app loading → seed demo patient → add Metoprolol (safe) → add Simvastatin (safe) → add Clarithromycin (CONFLICT fires) → read the clinical explanation
- Record with Loom or OBS
- Narrate: "The walker traverses the graph and finds that both Simvastatin and Clarithromycin connect to CYP3A4 — and Clarithromycin is an inhibitor. No lookup table. Pure graph reasoning."

---

## 13. Build Order (48-hour sprint)

### Day 1 (Today — May 16)
- [ ] `pip install jaseci` and verify `jac start` works
- [ ] Write node and edge definitions
- [ ] Write seed data initialization — get all 15 drugs wired to enzymes/organs
- [ ] Implement `IngestionWalker` — drug add + edge creation
- [ ] Implement `ConflictWalker` — enzyme conflict detection (no LLM yet)
- [ ] Test: add Simvastatin + Clarithromycin → verify conflict detected in console

### Day 2 (May 17)
- [ ] Implement `ReportWalker` with `by llm()` explanation generation
- [ ] Implement all `def:pub` API endpoints
- [ ] Build `jac-client` frontend — three panels
- [ ] Wire frontend to API endpoints
- [ ] Implement OpenFDA fallback
- [ ] End-to-end test: full demo flow works

### Day 3 (May 18)
- [ ] Polish frontend — colors, risk badges, organ heatmap
- [ ] Add error handling
- [ ] Deploy to Render.com for a live demo URL
- [ ] Record 3-minute demo video
- [ ] Write Devpost README

### May 19 — Submit by 4:00 PM EDT (1 hour buffer)
- [ ] Submit on Devpost with GitHub repo link, demo URL, video

---

## 14. Key Jac Concepts to Use Correctly

Claude Code should be aware of these Jac-specific patterns:

**Graph traversal syntax:**
```jac
visit [-->](?:Drug);          # visit all Drug nodes connected forward
visit [<--](?:Enzyme);        # visit all Enzyme nodes connected backward
nodes = [root-->](?:Patient); # get all Patient nodes from root
```

**byLLM — the type signature IS the prompt:**
```jac
def function_name(param: TypeA, param2: TypeB) -> ReturnType
    by llm();
# No system prompt needed. Jac extracts semantics from types + docstring.
```

**jac-client frontend component:**
```jac
cl def:pub app() -> JsxElement {
    has state_var: list = [];
    async can with entry { state_var = await some_api_call(); }
    return <div>...</div>;
}
```

**Walker spawn:**
```jac
ConflictWalker(conflicts=[]) spawn patient_node;
```

**Node creation and edge:**
```jac
new_drug = Drug(name="Warfarin", dose_mg=5.0);
patient_node ++> new_drug;   # create edge patient → drug
```

---

## 15. What NOT to Build

To stay in scope for a 48-hour hackathon:

- No user authentication (single patient demo is fine)
- No actual medical database subscription (OpenFDA free tier is enough)
- No dosing recommendations (out of scope for safety)
- No mobile app
- No real-time collaboration
- No prescription OCR / image upload
- No integration with pharmacy systems

The judges are evaluating Jac usage depth, not feature breadth. A clean, working, deeply Jac-native core beats a sprawling half-working app every time.