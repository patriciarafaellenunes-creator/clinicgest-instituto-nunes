export function KpiCard({
  label,
  value,
  sublabel,
  trend,
  tone = "default",
}: {
  label: string;
  value: string;
  sublabel?: string;
  trend?: string;
  tone?: "default" | "accent" | "accent-2";
}) {
  const valueColor =
    tone === "accent" ? "text-accent" : tone === "accent-2" ? "text-accent-2" : "text-text";

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`font-mono text-3xl font-bold tabular ${valueColor}`}>{value}</p>
      {sublabel && <p className="mt-1 text-sm text-text-muted">{sublabel}</p>}
      {trend && <p className="mt-2 text-xs text-accent">{trend}</p>}
    </div>
  );
}

export function StatTile({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-1.5 text-xs text-text-muted">{label}</p>
      <p className="font-mono text-xl font-semibold tabular">{value}</p>
      {sublabel && <p className="mt-1 text-xs text-text-muted">{sublabel}</p>}
    </div>
  );
}

const PRIORITY_STYLES: Record<string, string> = {
  alta: "bg-danger/15 text-danger",
  media: "bg-warn/15 text-warn",
  baixa: "bg-accent-2/15 text-accent-2",
};

export function PriorityBadge({ priority, label }: { priority: string; label: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
        PRIORITY_STYLES[priority] ?? "bg-surface-2 text-text-muted"
      }`}
    >
      {label}
    </span>
  );
}
