import { FormEvent, useState } from 'react';

type Props = {
  onSubmit: (payload: { drug: string; indication: string; output_dir: string }) => Promise<void>;
  busy: boolean;
};

export default function RunForm({ onSubmit, busy }: Props) {
  const [drug, setDrug] = useState('semaglutide');
  const [indication, setIndication] = useState("alzheimer's disease");
  const [outputDir, setOutputDir] = useState('outputs');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({ drug: drug.trim(), indication: indication.trim(), output_dir: outputDir.trim() || 'outputs' });
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          <span>Drug</span>
          <input value={drug} onChange={(e) => setDrug(e.target.value)} placeholder="semaglutide" required />
        </label>
        <label>
          <span>Indication</span>
          <input value={indication} onChange={(e) => setIndication(e.target.value)} placeholder="alzheimer's disease" required />
        </label>
        <label>
          <span>Output directory</span>
          <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="outputs" />
        </label>
      </div>
      <div className="form-actions">
        <button className="primary-btn" disabled={busy} type="submit">
          {busy ? 'Starting…' : 'Run PharmNexus'}
        </button>
      </div>
    </form>
  );
}
