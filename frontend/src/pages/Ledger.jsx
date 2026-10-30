import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, DocButton, Field, FormDialog, NSelect, PageHeader, Panel, UploadField, run, useForm, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { fdate, fdt, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

function AdjustDialog({ open, setOpen, done }) {
  const [investors] = useLoad(open ? "/investors" : null);
  const [f, set] = useForm({ type: "BANK_CHARGE", amount: "", date: todayIST(), reason: "", investor_id: "", doc_id: null });
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Post authorised adjustment" testid="adjust-dialog"
      onSubmit={() => run(() => api.post("/ledger/adjustments", { ...f, investor_id: f.investor_id || null }), "Entry posted").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><NSelect testid="adjust-type-select" value={f.type} onChange={set("type")} options={["BANK_CHARGE", "EXPENSE", "ADJUSTMENT", "REFUND"].map((v) => ({ value: v, label: v.replace("_", " ") }))} /></Field>
        <Field label="Amount (₹, negative for credit)"><Input data-testid="adjust-amount-input" type="number" step="0.01" required value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Date"><Input type="date" required value={f.date} onChange={set("date")} /></Field>
        <Field label="Investor (optional)"><NSelect value={f.investor_id} onChange={set("investor_id")} placeholder="Company-level" options={(investors || []).map((i) => ({ value: i.id, label: i.name }))} /></Field>
      </div>
      <Field label="Reason"><Input data-testid="adjust-reason-input" required value={f.reason} onChange={set("reason")} /></Field>
      <Field label="Supporting document"><UploadField testid="adjust-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

export default function Ledger() {
  const { can, staff } = useMe();
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);
  const [d, reload] = useLoad("/ledger", { type: type || undefined, q: q || undefined, date_from: from || undefined, date_to: to || undefined });
  const reverse = (e) => { const reason = window.prompt(`Reason for reversing ${e.txn_id}`); if (reason) run(() => api.post(`/ledger/${e.txn_id}/reverse`, { reason }), "Reversal entry posted").then(reload); };
  const link = (r) => r.refs?.sale_id ? <Link className="text-amber-400 hover:underline" to={`/sales/${r.refs.sale_id}`}>order</Link>
    : r.refs?.roll_id ? <Link className="text-amber-400 hover:underline" to={`/rolls/${r.refs.roll_id}`}>roll</Link>
    : r.refs?.purchase_id ? <Link className="text-amber-400 hover:underline" to={`/inventory?purchase=${r.refs.purchase_id}`}>purchase</Link> : "—";
  return (
    <div>
      <PageHeader title="Live Transaction Ledger" subtitle="Append-only. Completed entries are never edited — corrections are posted as reversal or adjustment entries with a reason."
        actions={can("reverse") && <Button data-testid="new-adjustment-btn" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Adjustment</Button>} />
      <Panel title={<div className="w-64"><NSelect testid="ledger-type-filter" value={type} onChange={setType} placeholder="All entry types" options={Object.entries(d?.types || {}).map(([v, l]) => ({ value: v, label: l }))} /></div>}
        actions={<><Input data-testid="ledger-search" placeholder="Search txn, remarks…" className="w-52" value={q} onChange={(e) => setQ(e.target.value)} />
          <Input type="date" className="w-40" data-testid="ledger-from" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" className="w-40" data-testid="ledger-to" value={to} onChange={(e) => setTo(e.target.value)} /></>}>
        <DataTable testid="ledger-table" rowKey="txn_id" rows={d?.rows} columns={[
          { key: "txn_id", label: "Txn ID", render: (r) => <span className="font-mono text-xs">{r.txn_id}</span> },
          { key: "date", label: "Date", render: (r) => fdate(r.date) },
          { key: "type", label: "Type", render: (r) => <div><div className="text-sm">{r.type_label}</div><div className="font-mono text-[10px] text-muted-foreground">{r.type}{r.reversal_of ? ` · reverses ${r.reversal_of}` : ""}{r.reversed ? " · REVERSED" : ""}</div></div> },
          { key: "amount", label: "Amount", right: true, render: (r) => <span className={r.amount < 0 ? "text-red-400" : ""}>{inr(r.amount)}</span> },
          { key: "link", label: "Linked", render: link },
          { key: "docs", label: "Docs", render: (r) => r.doc_ids?.length ? r.doc_ids.map((x) => <DocButton key={x} id={x} label="Doc" />) : "—" },
          { key: "remarks", label: "Remarks", render: (r) => <div className="max-w-xs text-xs">{r.remarks}{r.reason && r.reason !== r.remarks && <div className="text-amber-400">Reason: {r.reason}</div>}</div> },
          { key: "created_by", label: "Posted", render: (r) => <div className="text-xs">{r.created_by}<div className="font-mono text-[10px] text-muted-foreground">{fdt(r.created_at)}</div></div> },
          ...(staff ? [{ key: "act", label: "", render: (r) => can("reverse") && d.reversible.includes(r.type) && !r.reversal_of && !r.reversed && <Button size="sm" variant="ghost" data-testid={`reverse-${r.txn_id}`} onClick={() => reverse(r)}><Undo2 className="h-4 w-4" /></Button> }] : []),
        ]} />
      </Panel>
      <AdjustDialog open={open} setOpen={setOpen} done={reload} />
    </div>
  );
}
