import { CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, PageHeader, Panel, useLoad } from "@/components/common";
import { fdt, inr } from "@/lib/fmt";

const show = (v, kind) => (kind === "money" ? inr(v) : kind === "bool" ? (v ? "Yes" : "No") : String(v));

export default function Reconciliation() {
  const [d, reload, loading] = useLoad("/reconciliation");
  return (
    <div>
      <PageHeader title="Automated Reconciliation" subtitle="Investor balances are cross-checked against roll-level funding, settlements, verified transfers and the ledger. Discrepancies are flagged, never silently adjusted."
        actions={<Button variant="outline" data-testid="run-reconciliation" onClick={reload} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Run checks</Button>} />
      {d && (
        <div data-testid="reconciliation-result" className={`mb-6 flex items-center gap-3 rounded-xl border p-4 ${d.ok ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-red-500/30 bg-red-500/5 text-red-400"}`}>
          {d.ok ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
          <div><div className="font-display text-lg font-bold">{d.ok ? "All checks reconciled" : `${d.checks.filter((c) => !c.ok).length} discrepancy(ies) found`}</div><div className="font-mono text-xs opacity-80">Run at {fdt(d.run_at)}</div></div>
        </div>
      )}
      <Panel>
        <DataTable testid="reconciliation-table" rowKey="check" rows={d?.checks} columns={[
          { key: "investor", label: "Scope" }, { key: "check", label: "Check" },
          { key: "expected", label: "Expected", right: true, render: (r) => show(r.expected, r.kind) },
          { key: "actual", label: "Actual", right: true, render: (r) => show(r.actual, r.kind) },
          { key: "ok", label: "Result", render: (r) => (r.ok ? <span className="text-emerald-400">✓ Reconciled</span> : <span className="text-red-400">✗ Mismatch</span>) },
        ]} />
      </Panel>
    </div>
  );
}
