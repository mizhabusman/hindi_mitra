// Shared presentational bits for assessment displays — used by both the live
// practice assessment modal (Practice) and the saved conversation report
// (ConversationReport), so the two can never visually drift.

// A labelled 0–100 skill bar.
export function Dim({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  return (
    <div className="dim">
      <div className="dimTop">
        <span className="dname">{label}</span>
        <span className="dval">{value == null ? "—" : Math.round(v)}</span>
      </div>
      <div className="track"><div className="fill" style={{ width: `${v}%` }} /></div>
    </div>
  );
}

// A titled feedback list (Strengths / To improve / Next steps). Renders nothing
// when there are no items.
export function FbCard({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className={`fbCard ${tone}`}>
      <h4>{title}</h4>
      <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}
