import type { RunResponse } from '../types';

export default function RunHistory({ runs, onSelect }: { runs: RunResponse[]; onSelect: (runId: string) => void }) {
  return (
    <div className="card">
      <div className="section-header"><h2>Recent runs</h2></div>
      <div className="history-list">
        {runs.map((run) => (
          <button key={run.run_id} className="history-item" onClick={() => onSelect(run.run_id)}>
            <div>
              <strong>{run.drug}</strong>
              <div className="muted small">{run.indication}</div>
            </div>
            <span className={`history-status ${run.status}`}>{run.status}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
