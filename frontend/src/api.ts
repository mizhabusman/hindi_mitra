// Thin API client. All requests include the session cookie.
import type {
  Assessment,
  Coach,
  Conversation,
  ConversationReport,
  CurrentUser,
  EmployeeDetail,
  EmployeeOption,
  Message,
  Overview,
  Persona,
  UserMetrics,
} from "./types";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // ── auth ──
  employees: () => req<EmployeeOption[]>("/api/auth/employees"),
  adminLogin: (password: string) =>
    req<CurrentUser>("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  employeeLogin: (user_id: number, password: string) =>
    req<CurrentUser>("/api/auth/employee-login", {
      method: "POST",
      body: JSON.stringify({ user_id, password }),
    }),
  logout: () => req<void>("/api/auth/logout", { method: "POST" }),
  me: () => req<CurrentUser>("/api/auth/me"),

  // ── personas ──
  personas: () => req<Persona[]>("/api/personas"),

  // ── conversations ──
  startConversation: (persona_key: string) =>
    req<{ conversation: Conversation; opener: Message }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ persona_key }),
    }),
  resumeConversation: (id: number) =>
    req<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}/resume`, {
      method: "POST",
    }),
  getConversation: (id: number) =>
    req<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}`),
  endConversation: (id: number) =>
    req<void>(`/api/conversations/${id}/end`, { method: "POST" }),
  createAssessment: (id: number) =>
    req<Assessment>(`/api/conversations/${id}/assessment`, { method: "POST" }),
  getAssessment: (id: number) => req<Assessment>(`/api/conversations/${id}/assessment`),

  // ── admin ──
  overview: () => req<Overview>("/api/admin/overview"),
  adminUsers: () => req<UserMetrics[]>("/api/admin/users"),
  createUser: (body: { username: string; password: string; display_name?: string; role?: string }) =>
    req<unknown>("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
  updateUser: (id: number, body: Record<string, unknown>) =>
    req<unknown>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteUser: (id: number) => req<void>(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminUserDetail: (id: number) => req<EmployeeDetail>(`/api/admin/users/${id}/detail`),
  conversationReport: (id: number) => req<ConversationReport>(`/api/admin/conversations/${id}/report`),
  generateConversationAssessment: (id: number) =>
    req<Assessment>(`/api/admin/conversations/${id}/assessment`, { method: "POST" }),
  managerTeam: () => req<UserMetrics[]>("/api/manager/team"),

  // ── speech ──
  speechConfig: () => req<{ enabled: boolean }>("/api/speech/config"),
  speechToken: () => req<{ token: string; region: string }>("/api/speech/token"),
};

// Stream a turn via SSE (fetch-based, since EventSource can't POST).
export interface TurnEvents {
  onDelta?: (text: string) => void;
  onDone?: (msg: Message) => void;
  onScore?: (payload: { live_score: number | null; live_level: string | null; turn: any; coach?: Coach }) => void;
  onError?: (detail: string) => void;
}

export async function streamTurn(
  conversationId: number,
  text: string,
  ev: TurnEvents,
  pronunciation: number | null = null,
  liveCoach: boolean = true
): Promise<void> {
  const res = await fetch(`/api/conversations/${conversationId}/turns`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, pronunciation, live_coach: liveCoach }),
  });
  if (!res.ok || !res.body) {
    ev.onError?.(`Turn failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.type === "delta") ev.onDelta?.(evt.text);
      else if (evt.type === "done") ev.onDone?.(evt.message);
      else if (evt.type === "score") ev.onScore?.(evt);
      else if (evt.type === "error") ev.onError?.(evt.detail);
    }
  }
}
