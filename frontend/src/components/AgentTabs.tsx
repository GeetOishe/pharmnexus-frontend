import { useMemo, useState } from 'react';
import type { AgentResult } from '../types';

export default function AgentTabs({ agents }: { agents: Record<string, AgentResult> | undefined }) {
  const keys = useMemo(() => Object.keys(agents ?? {}), [agents]);
  const [active, setActive] = useState<string>('clinical_trials');

  if (!agents || keys.length === 0) {
    return (
      <div className="card">
        <div className="section-header"><h2>Agent evidence</h2></div>
        <p className="muted">Agent results will appear here.</p>
      </div>
    );
  }

  const currentKey = keys.includes(active) ? active : keys[0];
  const agent = agents[currentKey];

  return (
    <div className="card">
      <div className="section-header"><h2>Agent evidence</h2></div>
      <div className="tab-row">
        {keys.map((key) => (
          <button key={key} className={key === currentKey ? 'tab active' : 'tab'} onClick={() => setActive(key)}>
            {key}
          </button>
        ))}
      </div>
      <div className="agent-summary">
        <p>{agent.summary}</p>
      </div>
      <div className="evidence-list">
        {agent.evidence.slice(0, 12).map((item) => (
          <div className="evidence-card" key={`${item.source_type}-${item.source_id}`}>
            <div className="evidence-top">
              <strong>{item.title || item.source_id}</strong>
              <span>score {item.relevance_score.toFixed(2)}</span>
            </div>
            <div className="muted small">{item.source_type} · {item.date || 'no date'} · confidence {item.confidence.toFixed(2)}</div>
            <p>{item.evidence_text || 'No excerpt available.'}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
