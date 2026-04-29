import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────
type StageStatus = "pending" | "running" | "done" | "error";
type Stage = {
  key: string; label: string; status: StageStatus;
  message?: string; started_at?: string; finished_at?: string;
};
type Evidence = {
  source_type?: string; source_id?: string; title?: string;
  url?: string; date?: string; relevance_score?: number; confidence?: number;
  evidence_text?: string; evidence_domain?: string; risk_flags?: string[];
  regulatory_signal?: string; polarity?: string; match_level?: string;
  evidence_tier?: string; score_breakdown?: Record<string, number>;
  caveats?: string[]; metadata?: Record<string, unknown>;
};
type AgentResult = {
  agent_name?: string; summary?: string; evidence?: Evidence[];
  query_used?: string; retrieved_at_utc?: string;
  metrics?: Record<string, unknown>; notes?: string[];
};
type Decision = {
  decision?: string; confidence?: number; total_score?: number;
  reasoning?: string; strengths?: string[]; risks?: string[];
  recommended_next_steps?: string[]; blocking_factors?: string[];
  decision_breakdown?: Record<string, number>;
};
type Run = {
  run_id: string; status: string; drug: string; indication: string;
  created_at: string; updated_at: string; stages?: Stage[]; logs?: string[];
  agent_results?: Record<string, AgentResult>;
  aggregated?: { agent_results?: Record<string, AgentResult> } | null;
  decision?: Decision | null;
  artifacts?: Record<string, unknown> | null;
  error?: string | null;
  failed_agents?: Record<string, string>;
};

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
  timestamp: string;
  references?: ChatReference[];
};

type ChatReference = {
  agent_name: string;
  source_type?: string;
  source_id?: string;
  title?: string;
  url?: string;
  relevance_score?: number;
  confidence?: number;
  polarity?: string;
  evidence_tier?: string;
};

type AskRunResponse = {
  run_id: string;
  question: string;
  answer: string;
  status: string;
  references?: ChatReference[];
};

type Toast = { id: number; message: string; type: "success" | "error" };
type ConfirmOptions = { title: string; body: string; confirmLabel?: string; onConfirm: () => void };

// ── Constants ────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8005";
const AGENT_KEYS = ["clinical_trials", "patents", "literature", "knowledge_target", "safety_regulatory"] as const;
type AgentKey = (typeof AGENT_KEYS)[number];
const ALL_STAGE_KEYS = [...AGENT_KEYS, "aggregate", "decision"] as const;
const STAGE_LABELS: Record<string, string> = {
  clinical_trials: "Clinical Trials", patents: "Patents", literature: "Literature",
  knowledge_target: "Knowledge", safety_regulatory: "Safety & Regulatory",
  aggregate: "Aggregate", decision: "Decision",
};
const STAGE_SHORT: Record<string, string> = {
  clinical_trials: "Clinical", patents: "Patents", literature: "Literature",
  knowledge_target: "Knowledge", safety_regulatory: "Safety",
  aggregate: "Aggregate", decision: "Decision",
};
const EMPTY_STAGES: Stage[] = ALL_STAGE_KEYS.map(key => ({
  key, label: STAGE_SHORT[key] || key, status: "pending", message: "Waiting",
}));

// ── Comparison helpers ───────────────────────────────────────────
const RADAR_DIMS: { key: string; label: string; short: string }[] = [
  { key: "clinical_support_score",         label: "Clinical Support",        short: "Clinical"   },
  { key: "safety_clearance",               label: "Safety Clearance",        short: "Safety"     },
  { key: "mechanistic_plausibility_score", label: "Mechanistic Plausibility",short: "Mech."      },
  { key: "evidence_sufficiency_score",     label: "Evidence Sufficiency",    short: "Evidence"   },
  { key: "regulatory_feasibility_score",   label: "Regulatory",              short: "Reg."       },
  { key: "ip_clearance",                   label: "IP Clearance",            short: "IP"         },
  { key: "literature_evidence_score",      label: "Literature",              short: "Literature" },
  { key: "confidence",                     label: "Confidence",              short: "Conf."      },
];

const ALL_COMPARE_DIMS: { key: string; label: string }[] = [
  { key: "clinical_support_score",         label: "Clinical Support"        },
  { key: "safety_clearance",               label: "Safety Clearance"        },
  { key: "safety_risk_score",              label: "Safety Risk"             },
  { key: "mechanistic_plausibility_score", label: "Mechanistic Plausibility"},
  { key: "evidence_sufficiency_score",     label: "Evidence Sufficiency"    },
  { key: "regulatory_feasibility_score",   label: "Regulatory Feasibility"  },
  { key: "ip_clearance",                   label: "IP Clearance"            },
  { key: "strategic_risk_score",           label: "Strategic Risk"          },
  { key: "literature_evidence_score",      label: "Literature Evidence"     },
  { key: "confidence",                     label: "Confidence"              },
  { key: "total_score",                    label: "Total Score"             },
];

function getRunScores(run: Run): Record<string, number> {
  const bd = run.decision?.decision_breakdown || {};
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(bd)) {
    if (typeof v === "number") scores[k] = v;
  }
  if (typeof bd.safety_risk_score === "number")
    scores.safety_clearance = Math.max(0, 1 - bd.safety_risk_score);
  if (typeof bd.strategic_risk_score === "number")
    scores.ip_clearance = Math.max(0, 1 - bd.strategic_risk_score);
  if (typeof run.decision?.confidence === "number")
    scores.confidence = run.decision.confidence;
  if (typeof run.decision?.total_score === "number")
    scores.total_score = run.decision.total_score;
  return scores;
}

// ── API ──────────────────────────────────────────────────────────
async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Design tokens ────────────────────────────────────────────────
type Tokens = {
  mode: "dark" | "light";
  bg: string; bgAlt: string;
  surface: string; surface2: string; surface3: string;
  border: string; borderStrong: string;
  text: string; textSub: string; muted: string; faint: string;
  accent: string; accentHover: string;
  green: string; greenDim: string; greenBorder: string;
  amber: string; amberDim: string; amberBorder: string;
  red: string; redDim: string; redBorder: string;
  blue: string; blueDim: string; blueBorder: string;
  purple: string; purpleDim: string; purpleBorder: string;
  logBg: string; shimmer: string; inputBg: string; heroGlow: string;
  headerGradient: string; cardGlow: string;
};

const DARK: Tokens = {
  mode: "dark",
  bg: "#04091a", bgAlt: "#030712",
  surface: "#080f20", surface2: "#0c1530", surface3: "#101a38",
  border: "rgba(99,130,255,0.10)", borderStrong: "rgba(99,130,255,0.18)",
  text: "#e2eaff", textSub: "#94a8cc", muted: "#5d78a0", faint: "#2d4060",
  accent: "#4f8ef7", accentHover: "#3b7ef0",
  green: "#22d07a", greenDim: "rgba(34,208,122,0.13)", greenBorder: "rgba(34,208,122,0.30)",
  amber: "#f5a623", amberDim: "rgba(245,166,35,0.13)", amberBorder: "rgba(245,166,35,0.30)",
  red:   "#f05252", redDim:   "rgba(240,82,82,0.13)",  redBorder:   "rgba(240,82,82,0.30)",
  blue:  "#60a5fa", blueDim:  "rgba(96,165,250,0.13)", blueBorder:  "rgba(96,165,250,0.30)",
  purple:"#a78bfa", purpleDim:"rgba(167,139,250,0.13)",purpleBorder:"rgba(167,139,250,0.30)",
  logBg: "rgba(0,0,0,0.3)",
  shimmer: "shimmer-dark",
  inputBg: "rgba(99,130,255,0.06)",
  heroGlow: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(79,142,247,0.18) 0%, transparent 70%)",
  headerGradient: "linear-gradient(90deg, rgba(79,142,247,0.07) 0%, transparent 60%)",
  cardGlow: "0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(99,130,255,0.08)",
};

const LIGHT: Tokens = {
  mode: "light",
  bg: "#f0f3ff", bgAlt: "#e8ecfc",
  surface: "#ffffff", surface2: "#f5f7ff", surface3: "#eef1fd",
  border: "rgba(79,99,235,0.10)", borderStrong: "rgba(79,99,235,0.18)",
  text: "#0f1535", textSub: "#3a4565", muted: "#5a6a90", faint: "#9aa5c0",
  accent: "#4361ee", accentHover: "#3451d1",
  green: "#0d9f5a", greenDim: "rgba(13,159,90,0.10)", greenBorder: "rgba(13,159,90,0.30)",
  amber: "#c47c10", amberDim: "rgba(196,124,16,0.10)", amberBorder: "rgba(196,124,16,0.30)",
  red:   "#dc2626", redDim:   "rgba(220,38,38,0.09)",  redBorder:   "rgba(220,38,38,0.30)",
  blue:  "#4361ee", blueDim:  "rgba(67,97,238,0.09)",  blueBorder:  "rgba(67,97,238,0.28)",
  purple:"#7c3aed", purpleDim:"rgba(124,58,237,0.09)", purpleBorder:"rgba(124,58,237,0.28)",
  logBg: "rgba(67,97,238,0.03)",
  shimmer: "shimmer-light",
  inputBg: "rgba(67,97,238,0.04)",
  heroGlow: "radial-gradient(ellipse 70% 40% at 50% 0%, rgba(67,97,238,0.10) 0%, transparent 70%)",
  headerGradient: "linear-gradient(90deg, rgba(67,97,238,0.06) 0%, transparent 60%)",
  cardGlow: "0 1px 4px rgba(67,97,238,0.08), 0 0 0 1px rgba(79,99,235,0.07)",
};

const ThemeCtx = createContext<Tokens>(DARK);

// ── Primitives ───────────────────────────────────────────────────
function Spinner({ size = 8, width = 1.5 }: { size?: number; width?: number }) {
  const C = useContext(ThemeCtx);
  return (
    <span className="spin" style={{
      width: size, height: size, flexShrink: 0,
      border: `${width}px solid ${C.blue}`, borderRightColor: "transparent",
      borderRadius: 99, display: "inline-block",
    }} />
  );
}

function LoadingDots() {
  const C = useContext(ThemeCtx);
  const s: React.CSSProperties = {
    display: "inline-block", width: 4, height: 4,
    borderRadius: 99, background: C.muted, margin: "0 1.5px",
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <span className="dot1" style={s} />
      <span className="dot2" style={s} />
      <span className="dot3" style={s} />
    </span>
  );
}

function Chip({ text, color }: { text: string; color?: string }) {
  const C = useContext(ThemeCtx);
  const defaultBg = C.mode === "dark" ? "rgba(99,130,255,0.10)" : "rgba(67,97,238,0.09)";
  const defaultBorder = C.mode === "dark" ? "rgba(99,130,255,0.22)" : "rgba(67,97,238,0.22)";
  const defaultColor = C.mode === "dark" ? "#94a8e8" : "#3a4d9e";
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", borderRadius: 999,
      background: color ? `${color}18` : defaultBg,
      border: `1px solid ${color ? `${color}40` : defaultBorder}`,
      color: color || defaultColor,
      letterSpacing: "0.02em", lineHeight: "18px", flexShrink: 0,
      fontWeight: 500,
    }}>{text}</span>
  );
}

function Label({ text, color }: { text: string; color?: string }) {
  const C = useContext(ThemeCtx);
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: color || C.faint,
      letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5,
    }}>{text}</div>
  );
}

function BulletList({ items }: { items: string[] }) {
  const C = useContext(ThemeCtx);
  return (
    <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.65 }}>{item}</li>
      ))}
    </ul>
  );
}

// ── ConfirmDialog ────────────────────────────────────────────────
function ConfirmDialog({ opts, onCancel }: { opts: ConfirmOptions; onCancel: () => void }) {
  const C = useContext(ThemeCtx);
  return (
    <>
      <div onClick={onCancel} style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
      }} />
      <div className="fadeUp" style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 201, width: 380,
        background: C.surface, border: `1px solid ${C.borderStrong}`,
        borderRadius: 16, padding: "24px",
        boxShadow: C.mode === "dark"
          ? "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(240,82,82,0.15)"
          : "0 16px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(220,38,38,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: "rgba(240,82,82,0.12)", border: "1px solid rgba(240,82,82,0.30)",
            display: "grid", placeItems: "center", fontSize: 16,
          }}>🗑</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{opts.title}</div>
            <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.65 }}>{opts.body}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onCancel} className="pill-btn" style={{
            height: 34, padding: "0 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: C.surface2, border: `1px solid ${C.borderStrong}`,
            color: C.muted, cursor: "pointer",
          }}>Cancel</button>
          <button onClick={() => { opts.onConfirm(); onCancel(); }} className="pill-btn" style={{
            height: 34, padding: "0 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
            background: "rgba(240,82,82,0.15)", border: "1px solid rgba(240,82,82,0.45)",
            color: "#f05252", cursor: "pointer",
          }}>{opts.confirmLabel || "Delete"}</button>
        </div>
      </div>
    </>
  );
}

// ── Toaster ──────────────────────────────────────────────────────
function Toaster({ toasts }: { toasts: Toast[] }) {
  const C = useContext(ThemeCtx);
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 300,
      display: "flex", flexDirection: "column-reverse", gap: 8,
      pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <div key={t.id} className="slideIn" style={{
          background: t.type === "success"
            ? (C.mode === "dark" ? "rgba(34,208,122,0.14)" : "rgba(13,159,90,0.10)")
            : (C.mode === "dark" ? "rgba(240,82,82,0.14)" : "rgba(220,38,38,0.09)"),
          border: `1px solid ${t.type === "success" ? C.greenBorder : C.redBorder}`,
          borderRadius: 10, padding: "11px 16px",
          color: t.type === "success" ? C.green : C.red,
          fontSize: 12.5, fontWeight: 600,
          display: "flex", alignItems: "center", gap: 9,
          boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
          minWidth: 220, maxWidth: 340,
          backdropFilter: "blur(8px)",
        }}>
          <span style={{ fontSize: 14 }}>{t.type === "success" ? "✓" : "✗"}</span>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────
function SkeletonCard({ delay = 0 }: { delay?: number }) {
  const C = useContext(ThemeCtx);
  return (
    <div className="fadeUp" style={{
      background: C.surface2, border: `1px solid ${C.border}`,
      borderLeft: `2px solid ${C.faint}`, borderRadius: "0 8px 8px 0",
      padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8,
      animationDelay: `${delay}ms`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div className={C.shimmer} style={{ height: 13, borderRadius: 5, width: "62%" }} />
        <div className={C.shimmer} style={{ height: 11, borderRadius: 5, width: 48, flexShrink: 0 }} />
      </div>
      <div className={C.shimmer} style={{ height: 10, borderRadius: 5, width: "88%" }} />
      <div className={C.shimmer} style={{ height: 10, borderRadius: 5, width: "55%" }} />
      <div style={{ display: "flex", gap: 5, marginTop: 2 }}>
        {[52, 68, 44, 58].map((w, i) => (
          <div key={i} className={C.shimmer} style={{ height: 17, borderRadius: 99, width: w }} />
        ))}
      </div>
    </div>
  );
}

function SkeletonDecision() {
  const C = useContext(ThemeCtx);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div className={C.shimmer} style={{ height: 28, width: 68, borderRadius: 99 }} />
        <div className={C.shimmer} style={{ height: 11, width: 90, borderRadius: 5 }} />
      </div>
      {[100, 80, 60, 90, 70].map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className={C.shimmer} style={{ height: 10, borderRadius: 5, width: 80, flexShrink: 0 }} />
          <div className={C.shimmer} style={{ flex: 1, height: 3, borderRadius: 99 }} />
          <div className={C.shimmer} style={{ height: 10, borderRadius: 5, width: 28, flexShrink: 0 }} />
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {[100, 88, 72].map((w, i) => (
          <div key={i} className={C.shimmer} style={{ height: 10, borderRadius: 5, width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

// ── StagePill ────────────────────────────────────────────────────
function StagePill({ stage, count, active, onClick }: {
  stage: Stage; count?: number; active?: boolean; onClick?: () => void;
}) {
  const C = useContext(ThemeCtx);
  const { status } = stage;
  const clr = status === "running" ? { c: C.blue, b: C.blueBorder, bg: C.blueDim }
    : status === "done"  ? { c: C.green, b: C.greenBorder, bg: C.greenDim }
    : status === "error" ? { c: C.red,   b: C.redBorder,   bg: C.redDim   }
    : { c: C.faint, b: C.border, bg: "transparent" };

  return (
    <button onClick={onClick} className="pill-btn" style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "4px 11px", borderRadius: 999, fontSize: 11, fontWeight: 600,
      letterSpacing: "0.02em", whiteSpace: "nowrap",
      background: active ? C.blueDim : clr.bg,
      border: `1px solid ${active ? C.accent : clr.b}`,
      color: active ? C.blue : clr.c,
      cursor: onClick ? "pointer" : "default",
      boxShadow: active ? `0 0 10px ${C.blueBorder}` : status === "done" ? `0 0 8px ${C.greenBorder}` : "none",
    }}>
      {status === "running" ? <Spinner />
        : status === "done"  ? <span style={{ fontSize: 9, color: C.green, fontWeight: 900 }}>✓</span>
        : status === "error" ? <span style={{ fontSize: 9, color: C.red,   fontWeight: 900 }}>✗</span>
        : <span style={{ width: 5, height: 5, borderRadius: 99, background: C.faint, display: "inline-block", flexShrink: 0 }} />}
      {STAGE_SHORT[stage.key] || stage.key}
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: 10, padding: "0 5px", borderRadius: 99,
          background: C.mode === "dark" ? "rgba(96,165,250,0.15)" : "rgba(67,97,238,0.10)",
          color: C.blue, fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}

// ── ScoreRow ─────────────────────────────────────────────────────
function ScoreRow({ label, value }: { label: string; value: number }) {
  const C = useContext(ThemeCtx);
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  const barColor = value >= 0.6 ? C.green : value >= 0.4 ? C.amber : C.red;
  const barGlow = value >= 0.6 ? C.greenBorder : value >= 0.4 ? C.amberBorder : C.redBorder;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 10.5, color: C.muted, width: 120, flexShrink: 0, textTransform: "capitalize" }}>
        {label.replace(/_score$/, "").replace(/_/g, " ")}
      </span>
      <div style={{ flex: 1, height: 5, borderRadius: 99, background: C.border }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 99,
          background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
          boxShadow: pct > 10 ? `0 0 6px ${barGlow}` : "none",
          transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
      <span style={{
        fontSize: 11, fontWeight: 600, color: barColor,
        width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums",
      }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

// ── DecisionPanel ────────────────────────────────────────────────
function DecisionPanel({ decision, running }: { decision?: Decision | null; running?: boolean }) {
  const C = useContext(ThemeCtx);

  if (running && !decision) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Spinner size={12} width={1.5} />
          <span style={{ fontSize: 12, color: C.muted }}>Computing decision <LoadingDots /></span>
        </div>
        <SkeletonDecision />
      </div>
    );
  }

  if (!decision) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 18 }}>🔬</span>
        <span style={{ fontSize: 12, color: C.faint }}>Start a run to see the Gate-1 decision.</span>
      </div>
    </div>
  );

  const d = decision.decision || "?";
  const tone = d === "GO"    ? { c: C.green, dim: C.greenDim, b: C.greenBorder }
    : d === "NO_GO" ? { c: C.red,   dim: C.redDim,   b: C.redBorder   }
    : { c: C.amber, dim: C.amberDim, b: C.amberBorder };

  const sections = [
    { label: "Strengths",  items: decision.strengths,              labelColor: C.green  },
    { label: "Risks",      items: decision.risks,                  labelColor: C.red    },
    { label: "Next steps", items: decision.recommended_next_steps, labelColor: C.purple },
  ].filter(s => s.items && s.items.length > 0);

  return (
    <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          background: tone.dim, border: `1px solid ${tone.b}`, color: tone.c,
          padding: "5px 16px", borderRadius: 999, fontWeight: 900, fontSize: 13,
          letterSpacing: "0.08em",
          boxShadow: `0 0 14px ${tone.b}`,
        }}>{d}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
            confidence {typeof decision.confidence === "number" ? (decision.confidence * 100).toFixed(0) + "%" : "—"}
          </span>
          <span style={{ fontSize: 11, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
            score {typeof decision.total_score === "number" ? decision.total_score.toFixed(2) : "—"}
          </span>
        </div>
      </div>

      {decision.decision_breakdown && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {Object.entries(decision.decision_breakdown)
            .filter(([k]) => k !== "total_score")
            .map(([k, v]) => <ScoreRow key={k} label={k} value={v as number} />)}
        </div>
      )}

      {decision.reasoning && (
        <p style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.65, margin: 0 }}>
          {decision.reasoning}
        </p>
      )}

      {decision.blocking_factors && decision.blocking_factors.length > 0 && (
        <div style={{
          background: C.mode === "dark" ? "rgba(245,166,35,0.06)" : "rgba(196,124,16,0.05)",
          border: `1px solid ${C.amberBorder}`, borderRadius: 8, padding: "8px 10px",
        }}>
          <Label text="Blocking factors" color={C.amber} />
          <BulletList items={decision.blocking_factors} />
        </div>
      )}

      {sections.map(({ label, items, labelColor }) => (
        <div key={label}>
          <Label text={label} color={labelColor} />
          <BulletList items={items!} />
        </div>
      ))}
    </div>
  );
}

// ── EvidenceCard ─────────────────────────────────────────────────
function EvidenceCard({ item, idx }: { item: Evidence; idx: number }) {
  const C = useContext(ThemeCtx);
  const [open, setOpen] = useState(false);
  const polarity = item.polarity || "unknown";
  const leftColor = polarity === "supportive" ? C.green
    : polarity === "contradictory" ? C.red : C.faint;

  return (
    <div className="fadeUp evidence-card" style={{
      borderLeft: `3px solid ${leftColor}`,
      background: C.surface2, border: `1px solid ${C.border}`,
      borderLeftColor: leftColor, borderRadius: "0 10px 10px 0",
      padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6,
      animationDelay: `${Math.min(idx * 35, 250)}ms`,
      boxShadow: C.cardGlow,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.45 }}>
          {item.title || item.source_id || "Untitled"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flexShrink: 0 }}>
          {typeof item.relevance_score === "number" && (
            <span style={{ fontSize: 10, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
              rel {item.relevance_score.toFixed(2)}
            </span>
          )}
          {typeof item.confidence === "number" && (
            <span style={{ fontSize: 10, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
              conf {item.confidence.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {item.source_type && <Chip text={item.source_type} />}
        {item.evidence_domain && <Chip text={item.evidence_domain} />}
        {item.match_level && <Chip text={item.match_level} />}
        {item.evidence_tier && <Chip text={item.evidence_tier} />}
        {item.polarity && <Chip text={item.polarity} color={leftColor} />}
        {(item.risk_flags || []).map(f => <Chip key={f} text={f} color={C.amber} />)}
        {item.regulatory_signal && <Chip text={item.regulatory_signal} color={C.blue} />}
        {item.date && <Chip text={item.date} />}
      </div>

      {item.evidence_text && (
        <div style={{ fontSize: 11, color: C.textSub, lineHeight: 1.6 }}>
          {open ? item.evidence_text : item.evidence_text.slice(0, 220)}
          {item.evidence_text.length > 220 && (
            <button onClick={() => setOpen(v => !v)} style={{
              background: "none", border: "none", color: C.accent,
              cursor: "pointer", padding: "0 3px", fontSize: 11,
            }}>{open ? " less" : "… more"}</button>
          )}
        </div>
      )}

      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer"
          style={{ fontSize: 10.5, color: C.accent, textDecoration: "none" }}>
          Open source ↗
        </a>
      )}

      {item.caveats && item.caveats.length > 0 && (
        <div style={{ fontSize: 10.5, color: C.faint, fontStyle: "italic", lineHeight: 1.5 }}>
          {item.caveats.join(" · ")}
        </div>
      )}
    </div>
  );
}

// ── RadarChart ───────────────────────────────────────────────────
function RadarChart({ scoresA, scoresB }: { scoresA: Record<string, number>; scoresB: Record<string, number> }) {
  const C = useContext(ThemeCtx);
  const N = RADAR_DIMS.length;
  const SIZE = 260;
  const cx = SIZE / 2, cy = SIZE / 2, R = 96, LR = R + 22;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / N;
  const pt = (r: number, i: number) => ({ x: cx + r * Math.cos(ang(i)), y: cy + r * Math.sin(ang(i)) });
  const ring = (s: number) =>
    RADAR_DIMS.map((_, i) => { const p = pt(R * s, i); return `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(" ") + " Z";
  const poly = (scores: Record<string, number>) =>
    RADAR_DIMS.map((d, i) => { const p = pt(R * Math.min(Math.max(scores[d.key] ?? 0, 0), 1), i); return `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`; }).join(" ") + " Z";

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ overflow: "visible" }}>
      {[0.25, 0.5, 0.75, 1].map((s, i) => (
        <path key={i} d={ring(s)} fill="none" stroke={C.border}
          strokeWidth={s === 1 ? 1.5 : 0.8} strokeDasharray={s < 1 ? "3 3"  : undefined} />
      ))}
      {RADAR_DIMS.map((_, i) => { const o = pt(R, i); return <line key={i} x1={cx} y1={cy} x2={o.x} y2={o.y} stroke={C.border} strokeWidth={0.8} />; })}
      <path d={poly(scoresB)} fill="rgba(245,166,35,0.12)" stroke={C.amber} strokeWidth={2} strokeLinejoin="round" />
      <path d={poly(scoresA)} fill="rgba(79,142,247,0.18)" stroke={C.accent} strokeWidth={2} strokeLinejoin="round" />
      {RADAR_DIMS.map((d, i) => { const v = Math.min(Math.max(scoresB[d.key] ?? 0, 0), 1); const p = pt(R * v, i); return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={C.amber} stroke={C.surface} strokeWidth={1.5} />; })}
      {RADAR_DIMS.map((d, i) => { const v = Math.min(Math.max(scoresA[d.key] ?? 0, 0), 1); const p = pt(R * v, i); return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={C.accent} stroke={C.surface} strokeWidth={1.5} />; })}
      {RADAR_DIMS.map((d, i) => {
        const p = pt(LR, i);
        const a = Math.cos(ang(i));
        const anchor = a > 0.1 ? "start" : a < -0.1 ? "end" : "middle";
        return <text key={i} x={p.x} y={p.y} fontSize={9.5} fill={C.textSub} textAnchor={anchor} dominantBaseline="middle" fontFamily="Inter,ui-sans-serif,sans-serif" fontWeight={500}>{d.short}</text>;
      })}
      {[0.25, 0.5, 0.75].map(s => (
        <text key={s} x={cx + 3} y={cy - R * s - 2} fontSize={7.5} fill={C.faint} textAnchor="start" dominantBaseline="auto" fontFamily="Inter,ui-sans-serif,sans-serif">{(s * 100).toFixed(0)}</text>
      ))}
    </svg>
  );
}

// ── MirroredBarRow ────────────────────────────────────────────────
function MirroredBarRow({ label, valueA, valueB }: { label: string; valueA: number; valueB: number }) {
  const C = useContext(ThemeCtx);
  const pA = Math.min(Math.max(valueA, 0), 1);
  const pB = Math.min(Math.max(valueB, 0), 1);
  const diff = valueA - valueB;
  const labelColor = diff > 0.06 ? C.accent : diff < -0.06 ? C.amber : C.muted;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 116px 1fr", alignItems: "center", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{
          width: `${(pA * 100).toFixed(1)}%`, height: 7,
          borderRadius: "99px 0 0 99px",
          background: `linear-gradient(270deg, ${C.accent}cc, ${C.accent})`,
          boxShadow: pA > 0.05 ? `0 0 5px ${C.blueBorder}` : "none",
          transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
      <div style={{ textAlign: "center", fontSize: 9.5, color: labelColor, fontWeight: Math.abs(diff) > 0.06 ? 600 : 400, padding: "0 4px" }}>
        {label}
      </div>
      <div style={{ display: "flex" }}>
        <div style={{
          width: `${(pB * 100).toFixed(1)}%`, height: 7,
          borderRadius: "0 99px 99px 0",
          background: `linear-gradient(90deg, ${C.amber}cc, ${C.amber})`,
          boxShadow: pB > 0.05 ? `0 0 5px ${C.amberBorder}` : "none",
          transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
    </div>
  );
}

// ── CompareView ───────────────────────────────────────────────────
function generateInsights(runA: Run, runB: Run, scoresA: Record<string, number>, scoresB: Record<string, number>): string[] {
  const insights: string[] = [];
  const dA = runA.decision?.decision, dB = runB.decision?.decision;
  if (dA && dB) {
    insights.push(dA === dB
      ? `Both analyses reach the same verdict: ${dA}.`
      : `Verdicts diverge — ${runA.drug} is ${dA} while ${runB.drug} is ${dB}.`);
  }
  const tsA = scoresA.total_score, tsB = scoresB.total_score;
  if (typeof tsA === "number" && typeof tsB === "number" && Math.abs(tsA - tsB) > 0.03) {
    const hi = tsA > tsB ? runA.drug : runB.drug;
    insights.push(`${hi} scores higher overall (${(tsA * 100).toFixed(0)}% vs ${(tsB * 100).toFixed(0)}%).`);
  }
  const divs = RADAR_DIMS
    .map(d => ({ label: d.label, delta: (scoresA[d.key] ?? 0) - (scoresB[d.key] ?? 0) }))
    .filter(d => Math.abs(d.delta) > 0.08)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const d of divs.slice(0, 3)) {
    const adv = d.delta > 0 ? runA.drug : runB.drug;
    insights.push(`${adv} has a ${(Math.abs(d.delta) * 100).toFixed(0)}% edge in ${d.label.toLowerCase()}.`);
  }
  const safeA = scoresA.safety_clearance ?? 0, safeB = scoresB.safety_clearance ?? 0;
  if (Math.abs(safeA - safeB) > 0.12) {
    const safer = safeA > safeB ? runA.drug : runB.drug;
    insights.push(`${safer} shows meaningfully better safety clearance (${(safeA * 100).toFixed(0)}% vs ${(safeB * 100).toFixed(0)}%).`);
  }
  if (insights.length === 0) insights.push("Both analyses are closely matched across all dimensions.");
  return insights;
}

function CompareView({ runA, runB, onBack }: { runA: Run; runB: Run; onBack: () => void }) {
  const C = useContext(ThemeCtx);
  const scoresA = getRunScores(runA);
  const scoresB = getRunScores(runB);
  const insights = generateInsights(runA, runB, scoresA, scoresB);
  const compareDims = ALL_COMPARE_DIMS.filter(d =>
    typeof scoresA[d.key] === "number" || typeof scoresB[d.key] === "number"
  );

  const dc = (d?: string) => d === "GO" ? C.green : d === "NO_GO" ? C.red : C.amber;
  const dd = (d?: string) => d === "GO" ? C.greenDim : d === "NO_GO" ? C.redDim : C.amberDim;
  const db = (d?: string) => d === "GO" ? C.greenBorder : d === "NO_GO" ? C.redBorder : C.amberBorder;

  const RunCard = ({ run, accent }: { run: Run; accent: string }) => (
    <div style={{
      flex: 1, background: C.surface2, border: `1px solid ${C.borderStrong}`,
      borderTop: `3px solid ${accent}`, borderRadius: 12, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 3 }}>{run.drug}</div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>{run.indication}</div>
      {run.decision?.decision && (
        <span style={{
          fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
          padding: "3px 11px", borderRadius: 999,
          color: dc(run.decision.decision), background: dd(run.decision.decision),
          border: `1px solid ${db(run.decision.decision)}`,
        }}>{run.decision.decision}</span>
      )}
      {typeof run.decision?.total_score === "number" && (
        <div style={{ marginTop: 8, fontSize: 11, color: C.muted }}>
          Score: <span style={{ fontWeight: 700, color: C.text }}>{(run.decision.total_score * 100).toFixed(0)}%</span>
          {typeof run.decision?.confidence === "number" && (
            <span style={{ marginLeft: 8, color: C.faint }}>conf {(run.decision.confidence * 100).toFixed(0)}%</span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ height: "100%", background: C.bg, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{
        height: 52, flexShrink: 0, padding: "0 20px",
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 12,
        boxShadow: `inset 0 -1px 0 ${C.border}`,
      }}>
        <button onClick={onBack} style={{
          height: 30, padding: "0 12px", borderRadius: 7, fontSize: 11, fontWeight: 600,
          background: C.inputBg, border: `1px solid ${C.borderStrong}`, color: C.muted,
          cursor: "pointer",
        }}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Run Comparison</span>
          <span style={{ fontSize: 11, color: C.faint }}>Gate-1 Benchmarking</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, background: C.accent, display: "inline-block", borderRadius: 2 }} />
            <span style={{ color: C.muted }}>{runA.drug}</span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, background: C.amber, display: "inline-block", borderRadius: 2 }} />
            <span style={{ color: C.muted }}>{runB.drug}</span>
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
        <div style={{ maxWidth: 940, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Run summary cards */}
          <div style={{ display: "flex", gap: 12 }}>
            <RunCard run={runA} accent={C.accent} />
            <RunCard run={runB} accent={C.amber} />
          </div>

          {/* Radar + insights row */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 14, padding: "16px 20px", flexShrink: 0,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>Profile Radar</div>
              <RadarChart scoresA={scoresA} scoresB={scoresB} />
              <div style={{ display: "flex", gap: 18, fontSize: 10.5, color: C.muted }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 14, height: 2.5, background: C.accent, display: "inline-block", borderRadius: 2 }} />
                  {runA.drug.slice(0, 14)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 14, height: 2.5, background: C.amber, display: "inline-block", borderRadius: 2 }} />
                  {runB.drug.slice(0, 14)}
                </span>
              </div>
            </div>
            <div style={{
              flex: 1, background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 14, padding: "16px 18px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Auto Insights</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {insights.map((ins, i) => (
                  <div key={i} className="fadeUp" style={{
                    animationDelay: `${i * 55}ms`,
                    background: C.surface2, border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: "9px 12px",
                    fontSize: 12, color: C.textSub, lineHeight: 1.65,
                    display: "flex", gap: 9, alignItems: "flex-start",
                  }}>
                    <span style={{ color: C.accent, flexShrink: 0, fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>·</span>
                    {ins}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mirrored bar chart */}
          {compareDims.length > 0 && (
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 14, padding: "16px 20px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Dimension Comparison</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 116px 1fr", marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, color: C.accent, fontWeight: 600, textAlign: "right", paddingRight: 8 }}>{runA.drug.slice(0, 16)} →</div>
                <div />
                <div style={{ fontSize: 10.5, color: C.amber, fontWeight: 600, paddingLeft: 8 }}>← {runB.drug.slice(0, 16)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {compareDims.map(dim => (
                  <MirroredBarRow key={dim.key} label={dim.label} valueA={scoresA[dim.key] ?? 0} valueB={scoresB[dim.key] ?? 0} />
                ))}
              </div>
            </div>
          )}

          {/* Reasoning side-by-side */}
          {(runA.decision || runB.decision) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {([runA, runB] as const).map((run, idx) => run.decision ? (
                <div key={idx} style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 14, padding: "14px 16px",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, color: idx === 0 ? C.accent : C.amber }}>
                    {run.drug} — Reasoning
                  </div>
                  {run.decision.reasoning && (
                    <p style={{ fontSize: 11.5, color: C.textSub, lineHeight: 1.65, margin: "0 0 10px" }}>
                      {run.decision.reasoning}
                    </p>
                  )}
                  {run.decision.strengths && run.decision.strengths.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Label text="Strengths" color={C.green} />
                      <BulletList items={run.decision.strengths} />
                    </div>
                  )}
                  {run.decision.risks && run.decision.risks.length > 0 && (
                    <div>
                      <Label text="Risks" color={C.red} />
                      <BulletList items={run.decision.risks} />
                    </div>
                  )}
                </div>
              ) : <div key={idx} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Landing ──────────────────────────────────────────────────────
function Landing({
  drug, setDrug, indication, setIndication, busy, startRun,
  runs, runsLoading, onSelectRun, onRequestDelete, statusColor,
  selectedForCompare, onToggleCompare, onStartCompare,
}: {
  drug: string; setDrug: (v: string) => void;
  indication: string; setIndication: (v: string) => void;
  busy: boolean; startRun: () => void;
  runs: Run[]; runsLoading: boolean;
  onSelectRun: (id: string) => void;
  onRequestDelete: (run: Run) => void;
  statusColor: (s: string) => string;
  selectedForCompare: string[];
  onToggleCompare: (id: string) => void;
  onStartCompare: () => void;
}) {
  const C = useContext(ThemeCtx);

  const field: React.CSSProperties = {
    background: C.inputBg, border: `1px solid ${C.borderStrong}`,
    borderRadius: 8, color: C.text, padding: "0 36px 0 12px", fontSize: 13,
    outline: "none", height: 40, width: "100%",
    transition: "border-color 0.15s",
  };

  return (
    <div style={{
      height: "100%", background: C.bg, overflow: "auto",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      display: "flex", flexDirection: "column",
    }}>
      {/* Top minimal bar */}
      <div style={{
        height: 52, flexShrink: 0, padding: "0 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        boxShadow: `inset 0 -1px 0 ${C.border}, inset 0 1px 0 rgba(99,130,255,0.08)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9,
            background: "linear-gradient(135deg, #22d07a 0%, #4f8ef7 55%, #a78bfa 100%)",
            display: "grid", placeItems: "center",
            fontWeight: 900, fontSize: 10, color: "#fff",
            boxShadow: "0 2px 8px rgba(79,142,247,0.35)",
          }}>PN</div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.3px", color: C.text }}>PharmNexus</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selectedForCompare.length > 0 && (
            <span style={{ fontSize: 11, color: C.amber }}>
              {selectedForCompare.length}/2 selected for compare
            </span>
          )}
          {selectedForCompare.length === 0 && runs.length > 0 && (
            <span style={{ fontSize: 11, color: C.faint }}>
              {runs.length} previous analysis{runs.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Hero */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", padding: "52px 24px 40px",
        background: C.heroGlow, overflow: "auto",
      }}>
        {/* Title block */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 18, margin: "0 auto 18px",
            background: "linear-gradient(135deg, #22d07a 0%, #4f8ef7 50%, #a78bfa 100%)",
            display: "grid", placeItems: "center",
            fontWeight: 900, fontSize: 18, color: "#fff",
            boxShadow: C.mode === "dark"
              ? "0 8px 32px rgba(79,142,247,0.40), 0 0 0 1px rgba(167,139,250,0.2)"
              : "0 8px 24px rgba(67,97,238,0.28)",
            letterSpacing: "-0.5px",
          }}>PN</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: C.text, letterSpacing: "-0.7px", marginBottom: 8 }}>
            PharmNexus
          </h1>
          <p style={{ fontSize: 13.5, color: C.muted }}>
            Gate-1 Drug Repurposing Triage · AI-powered evidence synthesis
          </p>
        </div>

        {/* Form card */}
        <div style={{
          width: "100%", maxWidth: 480,
          background: C.surface, border: `1px solid ${C.borderStrong}`,
          borderRadius: 18, padding: "28px 28px 24px",
          boxShadow: C.mode === "dark"
            ? "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,130,255,0.10)"
            : "0 8px 40px rgba(67,97,238,0.12), 0 0 0 1px rgba(79,99,235,0.10)",
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Drug */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>
                DRUG COMPOUND
              </label>
              <div style={{ position: "relative" }}>
                <input
                  value={drug} onChange={e => setDrug(e.target.value)}
                  placeholder="e.g. semaglutide"
                  style={field}
                  onKeyDown={e => e.key === "Enter" && startRun()}
                />
                {drug && (
                  <button onClick={() => setDrug("")} style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: C.faint, cursor: "pointer",
                    fontSize: 16, lineHeight: 1, padding: "0 2px",
                  }}>×</button>
                )}
              </div>
            </div>

            {/* Indication */}
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>
                INDICATION
              </label>
              <div style={{ position: "relative" }}>
                <input
                  value={indication} onChange={e => setIndication(e.target.value)}
                  placeholder="e.g. alzheimer's disease"
                  style={field}
                  onKeyDown={e => e.key === "Enter" && startRun()}
                />
                {indication && (
                  <button onClick={() => setIndication("")} style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: C.faint, cursor: "pointer",
                    fontSize: 16, lineHeight: 1, padding: "0 2px",
                  }}>×</button>
                )}
              </div>
            </div>

            {/* Run button */}
            <button
              onClick={startRun}
              disabled={busy || !drug.trim() || !indication.trim()}
              style={{
                height: 44, borderRadius: 10, border: "none",
                background: busy || !drug.trim() || !indication.trim()
                  ? C.mode === "dark" ? "rgba(59,130,246,0.3)" : "rgba(37,99,235,0.25)"
                  : "#2563eb",
                color: "#fff", fontWeight: 700, fontSize: 13.5,
                cursor: busy || !drug.trim() || !indication.trim() ? "not-allowed" : "pointer",
                letterSpacing: "0.02em",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "background 0.15s",
                marginTop: 4,
              }}
            >
              {busy ? (
                <><Spinner size={14} width={2} /> Starting analysis…</>
              ) : (
                <>▶&nbsp; Start Analysis</>
              )}
            </button>
          </div>
        </div>

        {/* Run history */}
        {(runsLoading || runs.length > 0) && (
          <div style={{ width: "100%", maxWidth: 560, marginTop: 36 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: C.faint,
              letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>Analysis history</span>
              {runsLoading
                ? <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 400, letterSpacing: 0, textTransform: "none", color: C.muted }}>
                    <Spinner size={9} /> Loading…
                  </span>
                : <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", color: C.faint }}>
                    {runs.length} runs · select 2 to compare
                  </span>
              }
            </div>
            {runsLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} className={C.shimmer} style={{ height: 56, borderRadius: 10, animationDelay: `${i * 120}ms` }} />
                ))}
              </div>
            ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 460, overflowY: "auto" }}>
              {runs.map(run => {
                const decision = run.decision?.decision;
                const decisionColor = decision === "GO" ? C.green
                  : decision === "NO_GO" ? C.red
                  : decision === "HOLD" || decision === "INSUFFICIENT_EVIDENCE" ? C.amber
                  : null;
                const decisionDim = decision === "GO" ? C.greenDim
                  : decision === "NO_GO" ? C.redDim
                  : decision === "HOLD" || decision === "INSUFFICIENT_EVIDENCE" ? C.amberDim
                  : null;
                const decisionBorder = decision === "GO" ? C.greenBorder
                  : decision === "NO_GO" ? C.redBorder
                  : decision === "HOLD" || decision === "INSUFFICIENT_EVIDENCE" ? C.amberBorder
                  : null;
                const isActive = ["queued", "running", "retrying"].includes(run.status);
                return (
                  <div
                    key={run.run_id}
                    className="run-row"
                    style={{
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderLeft: `3px solid ${decisionColor || C.faint}`,
                      borderRadius: "0 10px 10px 0",
                      padding: "10px 12px",
                      display: "flex", alignItems: "center", gap: 10,
                      boxShadow: C.cardGlow,
                    }}
                  >
                    {/* Clickable area */}
                    <button
                      onClick={() => onSelectRun(run.run_id)}
                      style={{
                        flex: 1, background: "none", border: "none",
                        cursor: "pointer", color: C.text, textAlign: "left",
                        display: "flex", alignItems: "center", gap: 10, minWidth: 0,
                      }}
                    >
                      {/* Decision badge */}
                      {decision && decisionColor ? (
                        <span style={{
                          fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em",
                          padding: "3px 8px", borderRadius: 999, flexShrink: 0,
                          color: decisionColor, background: decisionDim!,
                          border: `1px solid ${decisionBorder!}`,
                        }}>{decision === "INSUFFICIENT_EVIDENCE" ? "INSUFF." : decision}</span>
                      ) : isActive ? (
                        <span style={{ flexShrink: 0 }}><Spinner size={8} /></span>
                      ) : (
                        <span style={{
                          width: 8, height: 8, borderRadius: 99, flexShrink: 0,
                          background: statusColor(run.status), display: "inline-block",
                        }} />
                      )}

                      {/* Drug + indication */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {run.drug}
                        </div>
                        <div style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {run.indication}
                        </div>
                      </div>

                      {/* Score + date pushed to right */}
                      <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                        {typeof run.decision?.total_score === "number" && (
                          <span style={{ fontSize: 10.5, color: C.muted, fontVariantNumeric: "tabular-nums" }}>
                            {(run.decision.total_score * 100).toFixed(0)}%
                          </span>
                        )}
                        {typeof run.decision?.confidence === "number" && (
                          <span style={{ fontSize: 10, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
                            conf {(run.decision.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                        {run.created_at && (
                          <span style={{ fontSize: 10, color: C.faint }}>
                            {new Date(run.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={e => { e.stopPropagation(); onRequestDelete(run); }}
                      title="Delete this run and all its data from the database"
                      className="btn-delete"
                      style={{
                        width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                        background: "rgba(240,82,82,0.12)",
                        border: "1px solid rgba(240,82,82,0.40)",
                        color: "#f05252", cursor: "pointer", fontSize: 16, fontWeight: 700,
                        display: "grid", placeItems: "center",
                      }}
                    >×</button>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────
export default function App() {
  const [dark, setDark] = useState(true);
  const C = dark ? DARK : LIGHT;

  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [view, setView] = useState<"landing" | "active">("landing");
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null);
  const [drug, setDrug] = useState("semaglutide");
  const [indication, setIndication] = useState("alzheimer's disease");
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>("clinical_trials");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const pollingRef = useRef<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { void loadRuns(); }, []);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentRun?.logs?.length]);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, chatOpen]);
  useEffect(() => {
    setChatMessages(buildInitialChatMessages(currentRun));
    setChatQuestion("");
  }, [currentRun?.run_id]);

  const addToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);

  async function loadRuns() {
    setRunsLoading(true);
    try {
      const items = await apiGet<Run[]>("/runs");
      setRuns(Array.isArray(items) ? items : []);
    } catch { /* silent */ }
    finally { setRunsLoading(false); }
  }

  async function startRun() {
    if (!drug.trim() || !indication.trim()) return;
    setBusy(true);
    try {
      const run = await apiPost<Run>("/runs", { drug, indication, output_dir: "outputs" });
      setCurrentRun(run);
      setSelectedAgent("clinical_trials");
      setView("active");
      await loadRuns();
      poll(run.run_id);
    } catch {
      alert("Failed to start run. Is the backend running on port 8005?");
    } finally {
      setBusy(false);
    }
  }

  function poll(runId: string) {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = window.setInterval(async () => {
      try {
        const run = await apiGet<Run>(`/runs/${runId}`);
        setCurrentRun(run);
        if (["completed", "completed_with_errors", "failed"].includes(run.status)) {
          clearInterval(pollingRef.current!);
          await loadRuns();
        }
      } catch { /* silent */ }
    }, 2000);
  }

  async function deleteRun(runId: string) {
    try {
      await apiDelete<{ status: string }>(`/runs/${runId}`);
      setRuns(prev => prev.filter(r => r.run_id !== runId));
      if (currentRun?.run_id === runId) {
        setCurrentRun(null);
        setView("landing");
      }
      addToast("Run deleted successfully", "success");
    } catch (err) {
      addToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }

  function requestDeleteRun(run: Run) {
    setConfirmOpts({
      title: "Delete analysis?",
      body: `"${run.drug} · ${run.indication}" will be permanently removed — all evidence, scores, and decision data will be erased from the database.`,
      confirmLabel: "Yes, delete",
      onConfirm: () => void deleteRun(run.run_id),
    });
  }

  async function selectRun(runId: string) {
    try {
      const run = await apiGet<Run>(`/runs/${runId}`);
      setCurrentRun(run);
      setView("active");
      const agentKeys = Object.keys(run.agent_results || run.aggregated?.agent_results || {});
      const firstAgent = agentKeys.find(k => AGENT_KEYS.includes(k as AgentKey)) as AgentKey | undefined;
      if (firstAgent) setSelectedAgent(firstAgent);
      // Only poll runs that are genuinely in-progress in this server session (never DB-only runs)
      const isDbRun = runId.startsWith("db-");
      const liveInProgress = !isDbRun && ["queued", "running", "retrying"].includes(run.status);
      if (liveInProgress) poll(runId);
    } catch { alert("Failed to load run."); }
  }

  async function retryAgent(agentName?: string) {
    if (!currentRun) return;
    const key = agentName ?? "all";
    setRetrying(key);
    try {
      const body = agentName ? { agents: [agentName] } : {};
      await apiPost<Run>(`/runs/${currentRun.run_id}/retry`, body);
      poll(currentRun.run_id);
    } catch (err) {
      alert(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetrying(null);
    }
  }

  async function askRunQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed || !currentRun?.run_id) return;

    setChatOpen(true);
    setChatMessages(prev => [
      ...prev,
      { role: "user", content: trimmed, timestamp: new Date().toISOString() },
    ]);
    setChatQuestion("");
    setChatBusy(true);

    try {
      const response = await apiPost<AskRunResponse>(`/runs/${currentRun.run_id}/ask`, {
        question: trimmed,
      });
      setChatMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: response.answer,
          timestamp: new Date().toISOString(),
          references: response.references || [],
        },
      ]);
    } catch (err) {
      setChatMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content:
            err instanceof Error
              ? `I couldn't answer from this run yet. ${err.message}`
              : "I couldn't answer from this run yet.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  const statusColor = (s: string) =>
    s === "completed" ? C.green
    : s === "failed" ? C.red
    : s === "running" ? C.blue
    : C.muted;

  const completedStatuses = ["completed", "completed_with_errors"];
  const stages: Stage[] = currentRun?.stages?.length
    ? currentRun.stages
    : currentRun
      ? ALL_STAGE_KEYS.map(key => ({
          key, label: STAGE_SHORT[key] || key,
          status: (completedStatuses.includes(currentRun.status) ? "done"
            : currentRun.status === "failed" ? "error"
            : "pending") as StageStatus,
          message: completedStatuses.includes(currentRun.status) ? "Completed" : currentRun.status,
        }))
      : EMPTY_STAGES;
  const agentResults = currentRun?.agent_results || currentRun?.aggregated?.agent_results || {};
  const activeAgent = agentResults[selectedAgent] || null;
  const activeEvidence = activeAgent?.evidence || [];
  const activeStage = stages.find(s => s.key === selectedAgent);
  const evidenceCounts: Record<string, number> = Object.fromEntries(
    Object.entries(agentResults).map(([k, v]) => [k, v.evidence?.length || 0])
  );
  const isDbRun = currentRun?.run_id?.startsWith("db-") ?? false;
  const isRunning = !isDbRun && ["queued", "running", "retrying"].includes(currentRun?.status || "");

  // Theme toggle button (reused in both views)
  const ThemeBtn = (
    <button
      onClick={() => setDark(v => !v)}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        height: 30, width: 30, borderRadius: 7,
        background: C.inputBg, border: `1px solid ${C.borderStrong}`,
        color: C.muted, fontSize: 14, cursor: "pointer",
        display: "grid", placeItems: "center", flexShrink: 0,
        transition: "background 0.15s",
      }}
    >{dark ? "☀" : "🌙"}</button>
  );

  return (
    <ThemeCtx.Provider value={C}>
      <div style={{
        height: "100vh", overflow: "hidden",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", fontSize: 13,
        color: C.text, background: C.bg,
        transition: "background 0.2s, color 0.2s",
      }}>
        {confirmOpts && <ConfirmDialog opts={confirmOpts} onCancel={() => setConfirmOpts(null)} />}
        <Toaster toasts={toasts} />

        {/* ── LANDING ───────────────────────────────────────────── */}
        {view === "landing" && (
          <div style={{ height: "100%", position: "relative" }}>
            <Landing
              drug={drug} setDrug={setDrug}
              indication={indication} setIndication={setIndication}
              busy={busy} startRun={startRun}
              runs={runs} runsLoading={runsLoading}
              onSelectRun={selectRun} onRequestDelete={requestDeleteRun}
              statusColor={statusColor}
            />
            {/* Theme toggle overlay */}
            <div style={{ position: "absolute", top: 11, right: 16 }}>
              {ThemeBtn}
            </div>
          </div>
        )}

        {/* ── ACTIVE VIEW ───────────────────────────────────────── */}
        {view === "active" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

            {/* Header */}
            <header style={{
              height: 48, flexShrink: 0,
              background: C.surface,
              borderBottom: `1px solid ${C.border}`,
              borderTop: `2px solid transparent`,
              backgroundImage: `${C.headerGradient}`,
              backgroundClip: "padding-box",
              display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
              boxShadow: `0 1px 0 ${C.border}, inset 0 1px 0 rgba(99,130,255,0.12)`,
            }}>
              {/* Logo */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: "linear-gradient(135deg, #22c55e 0%, #3b82f6 100%)",
                  display: "grid", placeItems: "center",
                  fontWeight: 800, fontSize: 10, color: "#021a0e",
                }}>PN</div>
                <span style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-0.3px" }}>PharmNexus</span>
              </div>

              <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0 }} />

              {/* Current run context */}
              {currentRun && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: C.surface2, border: `1px solid ${C.border}`,
                  borderRadius: 7, padding: "4px 10px", fontSize: 12,
                }}>
                  <span style={{ fontWeight: 600, color: C.text }}>{currentRun.drug}</span>
                  <span style={{ color: C.faint }}>·</span>
                  <span style={{ color: C.muted }}>{currentRun.indication}</span>
                </div>
              )}

              {/* Status */}
              {currentRun && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  {isRunning ? (
                    <Spinner size={8} />
                  ) : (
                    <span style={{
                      width: 7, height: 7, borderRadius: 99,
                      background: statusColor(currentRun.status),
                      display: "inline-block",
                    }} />
                  )}
                  <span style={{ color: C.muted }}>{currentRun.status.replace(/_/g, " ")}</span>
                </div>
              )}

              <div style={{ flex: 1 }} />

              {/* Right controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => setChatOpen(v => !v)}
                  style={{
                    height: 30, padding: "0 12px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                    background: chatOpen ? C.blueDim : C.inputBg,
                    border: `1px solid ${chatOpen ? C.accent : C.borderStrong}`,
                    color: chatOpen ? C.blue : C.muted,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  ✦ Ask Run
                </button>
                <button
                  onClick={() => setView("landing")}
                  style={{
                    height: 30, padding: "0 12px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                    background: C.inputBg, border: `1px solid ${C.borderStrong}`, color: C.muted,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  + New Run
                </button>
                {ThemeBtn}
              </div>
            </header>

            {/* Stage pipeline bar */}
            <div style={{
              height: 44, flexShrink: 0,
              background: C.surface, borderBottom: `1px solid ${C.border}`,
              display: "flex", alignItems: "center",
              padding: "0 16px", gap: 4, overflowX: "auto",
            }}>
              {stages.map((stage, i) => (
                <div key={stage.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {i > 0 && (
                    <div style={{
                      width: 16, height: 1,
                      background: stage.status === "pending" ? C.border : C.faint,
                      flexShrink: 0,
                    }} />
                  )}
                  <StagePill
                    stage={stage}
                    count={evidenceCounts[stage.key]}
                    active={AGENT_KEYS.includes(stage.key as AgentKey) && selectedAgent === stage.key}
                    onClick={AGENT_KEYS.includes(stage.key as AgentKey)
                      ? () => setSelectedAgent(stage.key as AgentKey) : undefined}
                  />
                </div>
              ))}

              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingLeft: 8 }}>
                {Object.keys(currentRun?.failed_agents || {}).length > 0 &&
                  !["queued", "running", "retrying"].includes(currentRun?.status || "") && (
                  <button
                    onClick={() => void retryAgent()}
                    disabled={retrying !== null}
                    style={{
                      height: 28, padding: "0 11px", borderRadius: 6,
                      fontSize: 11, fontWeight: 600,
                      background: C.amberDim, border: `1px solid ${C.amberBorder}`, color: C.amber,
                      cursor: retrying !== null ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                      opacity: retrying !== null ? 0.6 : 1,
                    }}
                  >
                    {retrying === "all" ? <Spinner /> : "↺"}
                    Retry {Object.keys(currentRun!.failed_agents!).length} failed
                  </button>
                )}
              </div>
            </div>

            {/* Main content */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

              {/* Left: evidence panel */}
              <div style={{
                flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column",
                overflow: "hidden", borderRight: `1px solid ${C.border}`,
              }}>
                {/* Agent tabs */}
                <div style={{
                  flexShrink: 0, padding: "0 14px", height: 40,
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", gap: 2, overflowX: "auto",
                }}>
                  {AGENT_KEYS.map(key => {
                    const stage = stages.find(s => s.key === key);
                    const count = evidenceCounts[key] || 0;
                    const st = stage?.status || "pending";
                    const isActive = selectedAgent === key;
                    return (
                      <button key={key} onClick={() => setSelectedAgent(key)} style={{
                        padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: isActive ? C.blueDim : "transparent",
                        border: `1px solid ${isActive ? C.accent : "transparent"}`,
                        color: isActive ? C.blue : st === "done" ? C.muted : C.faint,
                        cursor: "pointer", whiteSpace: "nowrap",
                        display: "flex", alignItems: "center", gap: 4, height: 28,
                        transition: "background 0.12s, border-color 0.12s",
                      }}>
                        {st === "running" ? <Spinner /> : st === "done"
                          ? <span style={{ fontSize: 9, color: C.green }}>✓</span>
                          : st === "error"
                          ? <span style={{ fontSize: 9, color: C.red }}>✗</span>
                          : null}
                        {STAGE_SHORT[key]}
                        {count > 0 && (
                          <span style={{
                            fontSize: 10, padding: "0 5px", borderRadius: 99,
                            background: C.surface3, color: C.faint,
                          }}>{count}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Agent summary */}
                {activeAgent?.summary ? (
                  <div style={{
                    flexShrink: 0, padding: "8px 16px",
                    borderBottom: `1px solid ${C.border}`,
                    fontSize: 11.5, color: C.textSub, lineHeight: 1.6,
                    background: C.mode === "dark" ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.02)",
                  }}>
                    {activeAgent.summary.slice(0, 300)}{activeAgent.summary.length > 300 ? "…" : ""}
                  </div>
                ) : activeStage?.status === "running" ? (
                  <div style={{
                    flexShrink: 0, padding: "8px 16px",
                    borderBottom: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", gap: 8,
                    background: C.mode === "dark" ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.02)",
                  }}>
                    <Spinner size={10} />
                    <span style={{ fontSize: 11.5, color: C.faint }}>
                      Agent running <LoadingDots />
                    </span>
                  </div>
                ) : null}

                {/* Evidence list */}
                <div style={{
                  flex: 1, overflow: "auto",
                  padding: "12px 14px", display: "flex",
                  flexDirection: "column", gap: 7,
                }}>
                  {activeStage?.status === "running" && activeEvidence.length === 0 ? (
                    <>{[0, 1, 2, 3].map(i => <SkeletonCard key={i} delay={i * 80} />)}</>
                  ) : activeStage?.status === "error" ? (
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", gap: 14, paddingTop: 48, textAlign: "center",
                    }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: C.redDim, border: `1px solid ${C.redBorder}`,
                        display: "grid", placeItems: "center", fontSize: 20,
                      }}>✗</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 5 }}>Agent failed</div>
                        <div style={{ fontSize: 11.5, color: C.muted, maxWidth: 280 }}>
                          {currentRun?.failed_agents?.[selectedAgent] || "An error occurred."}
                        </div>
                      </div>
                      <button
                        onClick={() => void retryAgent(selectedAgent)}
                        disabled={retrying !== null}
                        style={{
                          padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                          background: C.redDim, border: `1px solid ${C.redBorder}`, color: C.red,
                          cursor: retrying !== null ? "not-allowed" : "pointer",
                          opacity: retrying !== null ? 0.6 : 1,
                          display: "flex", alignItems: "center", gap: 7,
                        }}
                      >
                        {retrying === selectedAgent ? <Spinner /> : "↺"} Retry {STAGE_SHORT[selectedAgent]}
                      </button>
                    </div>
                  ) : activeEvidence.length === 0 ? (
                    <div style={{
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", gap: 10, paddingTop: 48, textAlign: "center",
                    }}>
                      <div style={{ fontSize: 28, opacity: 0.4 }}>
                        {activeStage?.status === "pending" ? "⏳" : "🔍"}
                      </div>
                      <div style={{ fontSize: 12, color: C.faint }}>
                        {activeStage?.status === "pending"
                          ? "Waiting for agent to start…"
                          : "No evidence returned for this agent."}
                      </div>
                    </div>
                  ) : (
                    activeEvidence.map((item, idx) => (
                      <EvidenceCard key={`${item.source_id || "row"}-${idx}`} item={item} idx={idx} />
                    ))
                  )}
                </div>
              </div>

              {/* Center-right: Gate Decision + collapsible Logs */}
              <div style={{
                width: 380, flexShrink: 0, display: "flex", flexDirection: "column",
                overflow: "hidden", borderLeft: `1px solid ${C.border}`, background: C.surface,
              }}>
                {/* Decision header */}
                <div style={{
                  flexShrink: 0, padding: "10px 14px 8px",
                  borderBottom: `1px solid ${C.border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <Label text="Gate Decision" />
                  {currentRun?.decision?.decision && (
                    <span style={{
                      fontSize: 10, fontWeight: 800, letterSpacing: "0.05em",
                      borderRadius: 999, padding: "3px 9px",
                      color: currentRun.decision.decision === "GO" ? C.green
                        : currentRun.decision.decision === "NO_GO" ? C.red : C.amber,
                      background: currentRun.decision.decision === "GO" ? C.greenDim
                        : currentRun.decision.decision === "NO_GO" ? C.redDim : C.amberDim,
                      border: `1px solid ${currentRun.decision.decision === "GO" ? C.greenBorder
                        : currentRun.decision.decision === "NO_GO" ? C.redBorder : C.amberBorder}`,
                    }}>{currentRun.decision.decision}</span>
                  )}
                </div>

                {/* Decision body — takes all remaining height */}
                <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 16px" }}>
                  <DecisionPanel decision={currentRun?.decision} running={isRunning} />
                </div>

                {/* Logs — collapsible */}
                <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}` }}>
                  <button
                    onClick={() => setLogsOpen(v => !v)}
                    style={{
                      width: "100%", padding: "7px 14px",
                      background: "transparent", border: "none",
                      display: "flex", alignItems: "center", gap: 6,
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: C.faint,
                      letterSpacing: "0.08em", textTransform: "uppercase",
                    }}>Pipeline Logs</span>
                    {isRunning && <span style={{ marginLeft: 2 }}><LoadingDots /></span>}
                    <span style={{ marginLeft: "auto", fontSize: 10, color: C.faint }}>
                      {logsOpen ? "▾ hide" : "▸ show"}
                    </span>
                  </button>
                  {logsOpen && (
                    <div style={{ height: 220, overflow: "auto", padding: "4px 8px 10px", background: C.logBg }}>
                      {(currentRun?.logs || []).length === 0 ? (
                        <div style={{ padding: "12px 8px", textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: C.faint }}>
                            {isRunning ? "Logs will appear as the pipeline runs…" : "No logs recorded."}
                          </div>
                        </div>
                      ) : (
                        (currentRun?.logs || []).map((log, idx) => (
                          <div key={idx} style={{
                            fontSize: 10.5, color: C.muted,
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            padding: "2.5px 6px", lineHeight: 1.55,
                            borderBottom: `1px solid ${C.border}`,
                          }}>{log}</div>
                        ))
                      )}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              </div>

              {/* Far right: Chat panel — inline, not overlay */}
              {chatOpen && (
                <div style={{
                  width: 360, flexShrink: 0, display: "flex", flexDirection: "column",
                  overflow: "hidden", borderLeft: `1px solid ${C.borderStrong}`,
                  background: C.surface,
                }}>
                  {/* Chat header */}
                  <div style={{
                    flexShrink: 0, padding: "10px 14px",
                    borderBottom: `1px solid ${C.border}`,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Run Copilot ✦</div>
                      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 1 }}>Grounded in this run’s evidence</div>
                    </div>
                    <button
                      onClick={() => setChatOpen(false)}
                      style={{
                        width: 26, height: 26, borderRadius: 6, fontSize: 16, lineHeight: 1,
                        background: C.surface2, border: `1px solid ${C.border}`,
                        color: C.muted, cursor: "pointer", display: "grid", placeItems: "center",
                      }}
                    >×</button>
                  </div>

                  {/* Quick question pills */}
                  <div style={{
                    flexShrink: 0, padding: "8px 10px",
                    borderBottom: `1px solid ${C.border}`,
                    display: "flex", flexWrap: "wrap", gap: 5,
                  }}>
                    {[
                      "Why did this score this way?",
                      "Which source contributed most?",
                      "What caused the contradictions?",
                    ].map(q => (
                      <button
                        key={q}
                        onClick={() => void askRunQuestion(q)}
                        disabled={chatBusy || !currentRun}
                        style={{
                          background: C.surface3, border: `1px solid ${C.border}`,
                          color: C.textSub, borderRadius: 999, padding: "3px 9px",
                          fontSize: 10.5, cursor: chatBusy || !currentRun ? "not-allowed" : "pointer",
                          opacity: chatBusy || !currentRun ? 0.6 : 1,
                        }}
                      >{q}</button>
                    ))}
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflow: "auto", padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {chatMessages.map((message, idx) => (
                      <div
                        key={`${message.timestamp}-${idx}`}
                        style={{
                          alignSelf: message.role === "user" ? "flex-end" : "stretch",
                          maxWidth: message.role === "user" ? "92%" : "100%",
                          background: message.role === "user" ? C.blueDim : C.surface2,
                          border: `1px solid ${message.role === "user" ? C.blueBorder : C.border}`,
                          color: message.role === "user" ? C.text : C.textSub,
                          borderRadius: 10, padding: "8px 9px",
                          fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap",
                        }}
                      >
                        <div style={{ fontSize: 9.5, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em", color: message.role === "user" ? C.blue : C.faint }}>
                          {message.role === "user" ? "You" : "Run expert"}
                        </div>
                        {message.content}
                        {message.role === "assistant" && message.references && message.references.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 9.5, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>References</div>
                            {message.references.map((ref, refIdx) => (
                              <ReferenceCard key={`${ref.source_id || "ref"}-${refIdx}`} refItem={ref} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {chatBusy && (
                      <div style={{
                        background: C.surface2, border: `1px solid ${C.border}`,
                        borderRadius: 10, padding: "8px 9px", fontSize: 11, color: C.faint,
                        display: "flex", alignItems: "center", gap: 7,
                      }}>
                        <Spinner size={10} /> Reviewing run results…
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <form
                    onSubmit={e => { e.preventDefault(); void askRunQuestion(chatQuestion); }}
                    style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <textarea
                      value={chatQuestion}
                      onChange={e => setChatQuestion(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void askRunQuestion(chatQuestion); }}}
                      placeholder={currentRun ? "Ask about scores, evidence, or the decision…" : "Select a run first."}
                      disabled={!currentRun || chatBusy}
                      rows={3}
                      style={{
                        resize: "none", background: C.inputBg,
                        border: `1px solid ${C.borderStrong}`, borderRadius: 8,
                        color: C.text, padding: "8px 10px", fontSize: 11.5, outline: "none",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: C.faint }}>Enter to send · Shift+Enter for newline</span>
                      <button
                        type="submit"
                        disabled={!currentRun || chatBusy || !chatQuestion.trim()}
                        style={{
                          height: 28, padding: "0 12px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                          background: !currentRun || chatBusy || !chatQuestion.trim() ? C.inputBg : C.accent,
                          border: `1px solid ${!currentRun || chatBusy || !chatQuestion.trim() ? C.borderStrong : C.accent}`,
                          color: !currentRun || chatBusy || !chatQuestion.trim() ? C.faint : "#fff",
                          cursor: !currentRun || chatBusy || !chatQuestion.trim() ? "not-allowed" : "pointer",
                        }}
                      >{chatBusy ? "Thinking…" : "Ask ✦"}</button>
                    </div>
                  </form>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

function buildInitialChatMessages(run: Run | null): ChatMessage[] {
  const timestamp = new Date().toISOString();
  if (!run) {
    return [
      {
        role: "assistant",
        content: "Select a run and I can answer questions about scores, evidence, source contributions, and the final decision.",
        timestamp,
      },
    ];
  }
  return [
    {
      role: "assistant",
      content:
        `Ask me anything about ${run.drug} / ${run.indication}. ` +
        `I can explain why it scored the way it did, which sources mattered most, what contradictions were found, and how the final recommendation was formed.`,
      timestamp,
    },
  ];
}

function ReferenceCard({ refItem }: { refItem: ChatReference }) {
  const C = useContext(ThemeCtx);
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: C.surface,
        borderRadius: 8,
        padding: "7px 8px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.text, lineHeight: 1.45 }}>
          {refItem.title || refItem.source_id || "Untitled reference"}
        </div>
        {refItem.url ? (
          <a
            href={refItem.url}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 10, color: C.accent, textDecoration: "none", flexShrink: 0 }}
          >
            Open ↗
          </a>
        ) : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {refItem.agent_name ? <Chip text={refItem.agent_name} color={C.blue} /> : null}
        {refItem.source_type ? <Chip text={refItem.source_type} /> : null}
        {refItem.source_id ? <Chip text={refItem.source_id} /> : null}
        {refItem.polarity ? <Chip text={refItem.polarity} color={refItem.polarity === "contradictory" ? C.red : refItem.polarity === "supportive" ? C.green : C.muted} /> : null}
        {refItem.evidence_tier ? <Chip text={refItem.evidence_tier} /> : null}
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 10, color: C.faint, fontVariantNumeric: "tabular-nums" }}>
        {typeof refItem.relevance_score === "number" ? <span>rel {refItem.relevance_score.toFixed(2)}</span> : null}
        {typeof refItem.confidence === "number" ? <span>conf {refItem.confidence.toFixed(2)}</span> : null}
      </div>
    </div>
  );
}
