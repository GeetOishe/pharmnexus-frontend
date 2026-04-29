import type { RunResponse, StartRunRequest } from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function startRun(payload: StartRunRequest): Promise<RunResponse> {
  return api<RunResponse>('/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getRun(runId: string): Promise<RunResponse> {
  return api<RunResponse>(`/runs/${runId}`);
}

export function listRuns(): Promise<RunResponse[]> {
  return api<RunResponse[]>('/runs');
}
