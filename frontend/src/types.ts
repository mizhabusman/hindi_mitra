export type Role = "employee" | "manager" | "admin";

export interface CurrentUser {
  id: number;
  username: string;
  display_name: string | null;
  role: Role;
}

export interface Persona {
  key: string;
  label: string;
  emoji: string | null;
  accent_color: string | null;
  description: string | null;
  voice_config: { rate?: number; pitch?: number; prefer?: string } | null;
}

export interface Message {
  id: number;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

export interface Conversation {
  id: number;
  persona_key: string;
  status: "active" | "ended" | "abandoned";
  started_at: string;
  ended_at: string | null;
  live_score: number | null;
  live_level: string | null;
  input_tokens: number;
  output_tokens: number;
}

export interface TurnScore {
  fluency: number | null;
  grammar: number | null;
  vocabulary: number | null;
  coherence: number | null;
  code_mixing: number | null;
  pronunciation: number | null;
  composite: number;
  cefr_level: string | null;
  notes: string | null;
}

// Result of a single listen (browser or Azure). pronunciation is Azure-only.
export interface ListenResult {
  text: string;
  pronunciation: number | null;
}

export interface Correction {
  said: string;
  better: string;
  why: string;
}

export interface Assessment {
  conversation_id: number;
  overall_score: number;
  cefr_level: string;
  fluency: number | null;
  grammar: number | null;
  vocabulary: number | null;
  coherence: number | null;
  code_mixing: number | null;
  pronunciation: number | null;
  summary: string | null;
  strengths: string[];
  weaknesses: string[];
  corrections: Correction[];
  next_steps: string[];
  rubric_version: string;
  created_at: string;
}

export interface UserMetrics {
  id: number;
  username: string;
  display_name: string | null;
  role: Role;
  is_active: boolean;
  team_id: number | null;
  conversations: number;
  assessments: number;
  practice_seconds: number;
  avg_score: number | null;
  latest_level: string | null;
  latest_activity: string | null;
  total_tokens: number;
  estimated_cost: number;
}

export interface Overview {
  total_users: number;
  total_conversations: number;
  total_assessments: number;
  avg_score: number | null;
  total_cost: number;
  total_practice_seconds: number;
}

export interface EmployeeOption {
  id: number;
  name: string;
}

export interface ConversationRow {
  id: number;
  persona_key?: string;
  persona_label: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  live_score: number | null;
  live_level: string | null;
  assessment_score: number | null;
  assessment_level: string | null;
}

export interface HistoryPoint {
  score: number;
  level: string;
  date: string;
}

export interface EmployeeDetail {
  user: {
    id: number;
    username: string;
    display_name: string | null;
    role: string;
    is_active: boolean;
    created_at: string;
    last_login_at: string | null;
  };
  metrics: {
    conversations: number;
    assessments: number;
    practice_seconds: number;
    avg_score: number | null;
    latest_level: string | null;
    total_tokens: number;
    estimated_cost: number;
  };
  conversations: ConversationRow[];
  history: HistoryPoint[];
}
