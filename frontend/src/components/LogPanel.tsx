export default function LogPanel({ logs }: { logs: string[] }) {
  return (
    <div className="card">
      <div className="section-header"><h2>Reasoning and execution log</h2></div>
      <div className="log-box">
        {logs.length === 0 ? <div className="muted">No logs yet.</div> : logs.map((log, i) => <div key={`${i}-${log}`}>{log}</div>)}
      </div>
    </div>
  );
}
