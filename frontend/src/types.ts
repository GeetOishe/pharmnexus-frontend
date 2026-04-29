export type RunStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed';

export interface StartRunRequest {
  drug: string;
  indication: string;
  output_dir?: string;
}

export interface StageState {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
  started_at?: string;
  finished_at?: string;
}

export interface EvidenceItem {
  source_type: string;
  source_id: string;
  title: string;
  url?: string;
  date?: string;
  relevance_score: number;
  confidence: number;
  evidence_text: string;
  evidence_domain?: string;
  risk_flags?: string[];
  regulatory_signal?: string;
  polarity?: string;
  match_level?: string;
  evidence_tier?: string;
  score_breakdown?: Record<string, number>;
  caveats?: string[];
  metadata: Record<string, unknown>;
}

export interface AgentResult {
  agent_name: string;
  drug: string;
  indication: string;
  query_used: string;
  retrieved_at_utc: string;
  summary: string;
  evidence: EvidenceItem[];
  metrics: Record<string, unknown>;
  notes: string[];
}

export interface AggregatedResult {
  drug: string;
  indication: string;
  overall_summary: string;
  agent_results: Record<string, AgentResult>;
  highlights: string[];
  risks: string[];
  next_steps: string[];
}

export interface DecisionResult {
  decision: string;
  confidence: number;
  reasoning: string;
  strengths: string[];
  risks: string[];
  next_steps: string[];
}

export interface RunArtifacts {
  output_dir: string;
  report_path?: string;
  decision_path?: string;
  aggregate_evidence_path?: string;
  audit_path?: string;
  agent_output_paths?: Record<string, string>;
}

export interface RunResponse {
  run_id: string;
  status: RunStatus;
  drug: string;
  indication: string;
  created_at: string;
  updated_at: string;
  stages: StageState[];
  logs: string[];
  agent_results?: Record<string, AgentResult>;
  aggregated?: AggregatedResult;
  decision?: DecisionResult;
  artifacts?: RunArtifacts;
  error?: string;
  failed_agents?: Record<string, string>;
}
