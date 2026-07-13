// Shared display formatters (used across admin/employee views).

/** Human-readable duration from seconds, e.g. "1h 4m", "12m 3s", "9s". */
export function fmtTime(sec: number): string {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Local date + time from an ISO timestamp (backend sends UTC with an offset). */
export function fmtDate(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
