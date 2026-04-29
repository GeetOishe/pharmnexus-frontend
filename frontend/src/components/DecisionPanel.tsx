import type { DecisionResult } from '../types';

export default function DecisionPanel({ decision }: { decision?: DecisionResult }) {
  if (!decision) {
    return (
      <div className="card">
        <div className="section-header"><h2>Decision</h2></div>
        <p className="muted">No final decision yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-header"><h2>Decision</h2></div>
      <div className="decision-row">
        <span className="decision-badge">{decision.decision}</span>
        <span className="confidence">Confidence {decision.confidence.toFixed(2)}</span>
      </div>
      <p>{decision.reasoning}</p>
      <div className="triple-grid">
        <div>
          <h3>Strengths</h3>
          <ul>{decision.strengths.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h3>Risks</h3>
          <ul>{decision.risks.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <div>
          <h3>Next steps</h3>
          <ul>{decision.next_steps.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
