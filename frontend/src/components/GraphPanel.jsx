import { useMemo } from 'react';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css';

// Build a left-to-right layered layout: Patient | Drugs | Enzymes | Organs.
export default function GraphPanel({ patient, meds, report }) {
  const { nodes, edges } = useMemo(
    () => buildGraph(patient, meds, report),
    [patient, meds, report],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        panOnDrag
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={20} />
        <Controls className="!bg-slate-800 !border-slate-700" />
      </ReactFlow>
    </div>
  );
}

function buildGraph(patient, meds, report) {
  // Aggregate enzyme/organ wiring from the seed knowledge embedded in get_report
  // findings + a baseline seed map (kept in-frontend for visualization only).
  const enzymesUsed = new Set();
  const organsAffected = new Set();
  const drugEnzymes = {};
  const drugOrgans = {};
  for (const m of meds) {
    drugEnzymes[m.name] = DRUG_SEED[m.name]?.enzymes ?? [];
    drugOrgans[m.name] = DRUG_SEED[m.name]?.organs ?? [];
    drugEnzymes[m.name].forEach((e) => enzymesUsed.add(e));
    drugOrgans[m.name].forEach((o) => organsAffected.add(o));
  }

  const COL = { patient: 40, drug: 280, enzyme: 540, organ: 800 };
  const ROW = 90;
  const nodes = [];
  const edges = [];

  // Patient node
  nodes.push({
    id: 'patient',
    position: { x: COL.patient, y: 200 },
    data: { label: `🧑 ${patient.name}\nage ${patient.age} · GFR ${patient.kidney_function_gfr ?? patient.kidney_gfr}` },
    type: 'default',
    style: nodeStyle('#0ea5e9'),
  });

  // Drug nodes
  meds.forEach((m, i) => {
    const id = `drug-${m.name}`;
    const color = m.is_inhibitor ? '#ef4444' : m.is_inducer ? '#a855f7' : '#22d3ee';
    nodes.push({
      id,
      position: { x: COL.drug, y: 80 + i * ROW },
      data: {
        label: `💊 ${m.name}\n${m.dose_mg}mg · ${m.frequency}`,
      },
      style: nodeStyle(color),
    });
    edges.push({
      id: `e-patient-${id}`,
      source: 'patient',
      target: id,
      style: { stroke: '#64748b' },
      animated: false,
    });
  });

  // Enzyme nodes
  const enzymeList = Array.from(enzymesUsed);
  const conflictEnzymes = new Set((report?.findings ?? []).map((f) => f.enzyme));
  enzymeList.forEach((e, i) => {
    const id = `enz-${e}`;
    const isConflict = conflictEnzymes.has(e);
    nodes.push({
      id,
      position: { x: COL.enzyme, y: 80 + i * ROW },
      data: { label: `⚗️ ${enzymeLabel(e)}${isConflict ? '\n⚠ Possible interaction' : ''}` },
      style: nodeStyle(isConflict ? '#ef4444' : '#f59e0b'),
    });
  });

  // Drug → Enzyme edges
  for (const m of meds) {
    for (const e of drugEnzymes[m.name]) {
      const isConflict = conflictEnzymes.has(e);
      edges.push({
        id: `e-${m.name}-${e}`,
        source: `drug-${m.name}`,
        target: `enz-${e}`,
        label: 'processed by',
        labelStyle: { fill: '#94a3b8', fontSize: 9 },
        style: { stroke: isConflict ? '#ef4444' : '#475569', strokeWidth: isConflict ? 2.5 : 1.5 },
        animated: isConflict,
      });
    }
  }

  // Organ nodes
  const organList = Array.from(organsAffected);
  const organRiskMap = new Map((report?.organ_risks ?? []).map((o) => [o.organ, o.risk_score]));
  organList.forEach((o, i) => {
    const risk = organRiskMap.get(o) ?? 0;
    const id = `org-${o}`;
    const color = risk > 0.6 ? '#ef4444' : risk > 0.3 ? '#f97316' : risk > 0 ? '#f59e0b' : '#10b981';
    nodes.push({
      id,
      position: { x: COL.organ, y: 80 + i * ROW },
      data: { label: `🫀 ${o}${risk > 0 ? `\nrisk ${(risk * 100).toFixed(0)}%` : ''}` },
      style: nodeStyle(color),
    });
  });

  // Drug → Organ edges
  for (const m of meds) {
    for (const o of drugOrgans[m.name]) {
      edges.push({
        id: `e-${m.name}-${o}`,
        source: `drug-${m.name}`,
        target: `org-${o}`,
        label: 'may affect',
        labelStyle: { fill: '#94a3b8', fontSize: 9 },
        style: { stroke: '#475569', strokeWidth: 1, strokeDasharray: '4 3' },
      });
    }
  }

  return { nodes, edges };
}

function enzymeLabel(enzyme) {
  const friendly = {
    'CYP3A4': 'Liver pathway',
    'CYP2D6': 'Liver pathway (2D6)',
    'CYP2C9': 'Liver pathway (2C9)',
    'CYP2C19': 'Liver pathway (2C19)',
    'CYP1A2': 'Liver pathway (1A2)',
    'P-glycoprotein': 'Drug transporter',
  };
  return friendly[enzyme] ?? enzyme;
}

function nodeStyle(color) {
  return {
    background: 'rgba(15, 23, 42, 0.95)',
    color: '#e2e8f0',
    border: `2px solid ${color}`,
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 11,
    whiteSpace: 'pre-line',
    textAlign: 'center',
    minWidth: 110,
  };
}

// Mirror of the seed table in main.jac, used ONLY for visualization layout.
// (The agent's logic runs entirely on the Jac side; this just lets the UI
// draw the wiring without an extra walker call per render.)
const DRUG_SEED = {
  Warfarin: { enzymes: ['CYP2C9'], organs: ['Liver'] },
  Fluconazole: { enzymes: ['CYP3A4', 'CYP2C9'], organs: ['Liver'] },
  Clarithromycin: { enzymes: ['CYP3A4'], organs: ['Liver', 'Heart'] },
  Azithromycin: { enzymes: [], organs: ['Heart'] },
  Metoprolol: { enzymes: ['CYP2D6'], organs: ['Heart'] },
  Amiodarone: { enzymes: ['CYP2D6', 'CYP3A4'], organs: ['Heart', 'Thyroid'] },
  Simvastatin: { enzymes: ['CYP3A4'], organs: ['Liver'] },
  Sertraline: { enzymes: ['CYP2D6'], organs: ['Liver'] },
  Omeprazole: { enzymes: ['CYP2C19'], organs: ['Liver'] },
  Clopidogrel: { enzymes: ['CYP2C19'], organs: ['Liver'] },
  Digoxin: { enzymes: ['P-glycoprotein'], organs: ['Heart'] },
  Rifampin: { enzymes: ['CYP3A4', 'CYP2C9'], organs: ['Liver'] },
  Carbamazepine: { enzymes: ['CYP3A4'], organs: ['Liver', 'CNS'] },
  Tacrolimus: { enzymes: ['CYP3A4'], organs: ['Kidney'] },
  Ciprofloxacin: { enzymes: ['CYP1A2'], organs: ['Heart', 'Kidney'] },
};
