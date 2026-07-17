export type Role = "employee" | "admin";

export interface CurrentUser {
  id: number;
  employee_id: string | null;
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
  // Client-only: an examiner instruction sent with the /hidden tag. Hidden from
  // the chat view, but NOTE it is still sent to the model, persisted, scored,
  // and shown in the saved transcript — a limitation of this simple approach.
  hidden?: boolean;
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

// Per-turn AI Hindi Coach feedback (right-rail card). Generated fresh for the
// user's current reply only. Optional string fields are "" when not applicable.
export interface VocabTip {
  english: string;
  hindi: string;
}

export interface Coach {
  heading: string;
  assessment: string;
  is_correct: boolean;
  suggested_reply: string;
  why_better: string;
  alternative: string;
  vocab: VocabTip[];
  current_reply: string;
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
  employee_id: string | null;
  username: string;
  display_name: string | null;
  role: Role;
  is_active: boolean;
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
  employee_id: string | null;
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
  total_tokens: number;
  cost: number;
}

export interface HistoryPoint {
  score: number;
  level: string;
  date: string;
}

export interface ReportMessage {
  id: number;
  turn_index: number;
  role: "user" | "assistant";
  content: string;
  created_at: string | null;
}

// The persisted, read-only report for one conversation (saved assessment +
// full transcript + stats). Assembled entirely from stored data.
export interface ConversationReport {
  conversation: {
    id: number;
    persona_key: string | null;
    persona_label: string;
    persona_emoji: string | null;
    persona_accent: string | null;
    status: string;
    started_at: string;
    ended_at: string | null;
    duration_seconds: number | null;
    live_score: number | null;
    live_level: string | null;
  };
  employee: {
    id: number | null;
    employee_id: string | null;
    display_name: string | null;
    username: string | null;
  };
  stats: {
    message_count: number;
    user_messages: number;
    assistant_messages: number;
    user_words: number;
    duration_seconds: number | null;
  };
  assessment: Assessment | null;
  messages: ReportMessage[];
}

export interface EmployeeDetail {
  user: {
    id: number;
    employee_id: string | null;
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
