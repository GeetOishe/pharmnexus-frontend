import type { StageState } from '../types';

export default function StageList({ stages }: { stages: StageState[] }) {
  return (
    <div className="card">
      <div className="section-header">
        <h2>Execution progress</h2>
      </div>
      <div className="stages">
        {stages.map((stage) => (
          <div key={stage.key} className={`stage stage-${stage.status}`}>
            <div>
              <div className="stage-title">{stage.label}</div>
              <div className="stage-message">{stage.message || 'Waiting'}</div>
            </div>
            <div className="stage-status">{stage.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
