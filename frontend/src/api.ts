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

// A typed error so callers can distinguish an HTTP failure (with a status —
// e.g. 401 = truly unauthenticated) from a network/timeout failure (status 0),
// which is transient and must NOT be treated as "logged out".
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Generous ceiling so a genuinely long call (the end-of-conversation assessment
// runs ~15–40s) completes, while a hung request still fails instead of hanging
// the UI forever.
const REQUEST_TIMEOUT_MS = 120_000;

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      signal: controller.signal,
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
      throw new ApiError(detail, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Network error or timeout — status 0 marks it as transient.
    const aborted = e instanceof DOMException && e.name === "AbortError";
    throw new ApiError(
      aborted ? "The request timed out — please try again." : "Network error — please check your connection.",
      0
    );
  } finally {
    clearTimeout(timer);
  }
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
  startConversation: (persona_key: string, brief?: string) =>
    req<{ conversation: Conversation; opener: Message }>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ persona_key, brief: brief?.trim() || undefined }),
    }),
  resumeConversation: (id: number) =>
    req<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}/resume`, {
      method: "POST",
    }),
  // Live examiner instruction added mid-conversation (interview steering). Never
  // becomes a chat message; applies to the AI from its next reply onward.
  appendBrief: (id: number, text: string) =>
    req<void>(`/api/conversations/${id}/brief`, {
      method: "POST",
      body: JSON.stringify({ text }),
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
      let evt: any;
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }  // skip a malformed frame; keep the stream alive
      if (evt.type === "delta") ev.onDelta?.(evt.text);
      else if (evt.type === "done") ev.onDone?.(evt.message);
      else if (evt.type === "score") ev.onScore?.(evt);
      else if (evt.type === "error") ev.onError?.(evt.detail);
    }
  }
}
