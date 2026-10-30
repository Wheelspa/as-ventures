import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, DocButton, PageHeader, Panel, StatusBadge, run, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { fdate, inr } from "@/lib/fmt";
import { useMe } from "@/lib/me";

const FILTERS = [["", "All"], ["overdue", "Overdue"], ["transfer_pending", "Transfer pending"], ["verification_pending", "Awaiting verification"], ["awaiting_collection,awaiting_invoice", "Awaiting customer"], ["partially_settled", "Partial"], ["settled", "Settled"]];

function PendingTransfers({ reload: reloadParent }) {
  const { can } = useMe();
  const [rows, reload] = useLoad("/transfers", { status: "initiated" });
  const done = () => { reload(); reloadParent(); };
  const reject = (t) => { const reason = window.prompt("Reason for rejection"); if (reason) run(() => api.post(`/transfers/${t.id}/reject`, { reason }), "Rejected").then(done); };
  return (
    <Panel title="Bank transfers awaiting verification" className="mb-6" testid="pending-transfers">
      <DataTable rows={rows} empty="Nothing awaiting verification" columns={[
        { key: "transfer_no", label: "Transfer", render: (t) => <span className="font-mono text-xs">{t.transfer_no}</span> },
        { key: "order_no", label: "Order", render: (t) => <Link className="font-mono text-amber-400 hover:underline" to={`/sales/${t.sale_id}`}>{t.order_no}</Link> },
        { key: "kind", label: "Type", render: (t) => (t.kind === "principal" ? "Principal" : "Margin") },
        { key: "amount", label: "Amount", right: true, money: true }, { key: "bank_ref", label: "UTR" }, { key: "created_by", label: "Uploaded by" },
        { key: "doc", label: "Proof", render: (t) => <DocButton id={t.doc_id} /> },
        { key: "act", label: "", render: (t) => can("verify") && <div className="flex gap-1">
          <Button size="sm" data-testid={`pending-verify-${t.transfer_no}`} onClick={() => run(() => api.post(`/transfers/${t.id}/verify`), "Verified").then(done)}><Check className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => reject(t)}><X className="h-4 w-4" /></Button></div> },
      ]} />
    </Panel>
  );
}

export default function Settlements() {
  const { staff } = useMe();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [rows, reload] = useLoad("/settlements", { status: status || undefined, q: q || undefined });
  return (
    <div>
      <PageHeader title="Settlements" subtitle="Order-to-order principal recovery and margin payouts. Nothing is marked settled until the bank transfer is verified." />
      {staff && <PendingTransfers reload={reload} />}
      <Panel title={<div className="flex flex-wrap gap-1">{FILTERS.map(([v, l]) => (
        <button key={l} data-testid={`settlements-filter-${l.toLowerCase().replace(/ /g, "-")}`} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-xs font-medium ${status === v ? "bg-amber-600 text-black" : "border border-border/60 text-muted-foreground"}`}>{l}</button>))}</div>}
        actions={<Input data-testid="settlements-search" placeholder="Search order or roll" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <DataTable testid="settlements-table" rows={rows} columns={[
          { key: "settlement_no", label: "Settlement", render: (r) => <span className="font-mono text-xs">{r.settlement_no}</span> },
          { key: "order_no", label: "Order", render: (r) => <Link data-testid={`settlement-order-${r.order_no}`} className="font-mono text-amber-400 hover:underline" to={`/sales/${r.sale_id}`}>{r.order_no}</Link> },
          { key: "roll_serial", label: "Rolls", render: (r) => <span className="font-mono text-xs">{r.roll_serial}</span> },
          { key: "investor_name", label: "Investor" },
          { key: "pr", label: "Principal repaid / due", right: true, render: (r) => `${inr(r.principal_paid)} / ${inr(r.principal_due)}` },
          { key: "mr", label: "Margin paid / due", right: true, render: (r) => `${inr(r.margin_paid)} / ${inr(r.margin_due)}` },
          { key: "due_date", label: "Due", render: (r) => <span className={r.status === "overdue" ? "text-red-400" : ""}>{fdate(r.due_date)}</span> },
          { key: "ack", label: "Investor ack", render: (r) => (r.ack ? <span className="text-xs text-emerald-400">Acknowledged</span> : <span className="text-xs text-muted-foreground">—</span>) },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} testid={`settlement-row-status-${r.order_no}`} /> },
        ]} />
      </Panel>
    </div>
  );
}
