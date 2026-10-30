import { useState } from "react";
import { Input } from "@/components/ui/input";
import { DataTable, PageHeader, Panel, useLoad } from "@/components/common";
import { fdt } from "@/lib/fmt";

export default function Audit() {
  const [q, setQ] = useState("");
  const [rows] = useLoad("/audit", { q: q || undefined });
  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Timestamped, append-only log of every material action — who did what, when, and the values before and after." />
      <Panel actions={<Input data-testid="audit-search" placeholder="Search action, user, entity…" className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />} title="Events">
        <DataTable testid="audit-table" rows={rows} columns={[
          { key: "id", label: "ID", render: (r) => <span className="font-mono text-xs">{r.id}</span> },
          { key: "ts", label: "When", render: (r) => <span className="font-mono text-xs">{fdt(r.ts)}</span> },
          { key: "user", label: "User", render: (r) => <div>{r.user}<div className="text-[10px] text-muted-foreground">{r.role}</div></div> },
          { key: "action", label: "Action", render: (r) => <span className="font-mono text-xs text-amber-400">{r.action}</span> },
          { key: "entity", label: "Entity", render: (r) => <span className="text-xs">{r.entity} · <span className="font-mono">{String(r.entity_id).slice(0, 12)}</span></span> },
          { key: "details", label: "Details", render: (r) => <code className="block max-w-md whitespace-pre-wrap break-all text-[11px] text-muted-foreground">{r.before ? `before ${JSON.stringify(r.before)} → ` : ""}{JSON.stringify(r.details || {})}</code> },
        ]} />
      </Panel>
    </div>
  );
}
