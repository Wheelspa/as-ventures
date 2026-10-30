import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FileText, Wallet, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, DocButton, ExportButtons, Field, FormDialog, PageHeader, Panel, StatusBadge, UploadField, run, useForm, useLoad } from "@/components/common";
import { SettlementCard } from "@/components/SettlementCard";
import { Breakdown } from "@/pages/Sales";
import { api } from "@/lib/api";
import { AdminActions } from "@/components/AdminActions";
import { fdate, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

function InvoiceDialog({ open, setOpen, sale, done }) {
  const [f, set] = useForm({ invoice_no: "", invoice_date: todayIST(), doc_id: null });
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Issue sales invoice" testid="invoice-dialog" submitLabel="Issue invoice & mark roll sold"
      description="Leave the number blank to auto-generate. Upload the GST invoice if issued from your accounting system."
      onSubmit={() => run(() => api.post(`/sales/${sale.id}/invoice`, f), "Invoice issued").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number"><Input data-testid="invoice-no-input" value={f.invoice_no} onChange={set("invoice_no")} /></Field>
        <Field label="Invoice date"><Input data-testid="invoice-date-input" type="date" value={f.invoice_date} onChange={set("invoice_date")} /></Field>
      </div>
      <Field label="Invoice document"><UploadField testid="invoice-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

function CollectionDialog({ open, setOpen, sale, done }) {
  const [f, set] = useForm({ amount: "", date: todayIST(), mode: "Bank transfer", reference: "", doc_id: null });
  const due = sale.pricing.total - sale.collected;
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Record customer payment" testid="collection-dialog" description={`Outstanding receivable ${inr(due)}. Partial payments allowed.`}
      onSubmit={() => run(() => api.post(`/sales/${sale.id}/collections`, f), "Collection recorded, settlement recalculated").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount received (₹)"><div className="flex gap-1"><Input data-testid="collection-amount-input" type="number" step="0.01" required value={f.amount} onChange={set("amount")} />
          <Button type="button" variant="ghost" size="sm" data-testid="collection-fill-full" onClick={() => set("amount")((due / 100).toFixed(2))}>Full</Button></div></Field>
        <Field label="Date"><Input data-testid="collection-date-input" type="date" required value={f.date} onChange={set("date")} /></Field>
        <Field label="Mode"><Input data-testid="collection-mode-input" value={f.mode} onChange={set("mode")} /></Field>
        <Field label="Payment reference"><Input data-testid="collection-ref-input" required value={f.reference} onChange={set("reference")} /></Field>
      </div>
      <Field label="Receipt / proof"><UploadField testid="collection-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

export default function SaleDetail() {
  const { id } = useParams();
  const { can } = useMe();
  const nav = useNavigate();
  const [d, reload] = useLoad(`/sales/${id}`);
  const [inv, setInv] = useState(false);
  const [col, setCol] = useState(false);
  if (!d) return <div className="text-muted-foreground">Loading…</div>;
  const s = d.sale;
  const cancel = () => { const reason = window.prompt("Reason for cancelling this order"); if (reason) run(() => api.post(`/sales/${id}/cancel`, { reason }), "Order cancelled, roll released").then(reload); };
  return (
    <div>
      <PageHeader title={<span className="font-mono">{s.order_no}</span>}
        subtitle={`${s.customer_name}${s.customer_code ? " (" + s.customer_code + ")" : ""}${s.vehicle ? " · " + s.vehicle : ""} · sold ${fdate(s.order_date)}${s.invoice_no ? ` · invoice ${s.invoice_no} (${fdate(s.invoice_date)})` : ""}`}
        actions={<>
          <StatusBadge status={s.status} testid="sale-detail-status" />
          {can("record") && s.status === "reserved" && <Button data-testid="issue-invoice-btn" onClick={() => setInv(true)}><FileText className="mr-1 h-4 w-4" />Issue invoice</Button>}
          {can("record") && s.status === "reserved" && <Button variant="outline" data-testid="cancel-sale-btn" onClick={cancel}><XCircle className="mr-1 h-4 w-4" />Cancel</Button>}
          {can("record") && ["invoiced", "partially_paid"].includes(s.status) && <Button data-testid="record-collection-btn" onClick={() => setCol(true)}><Wallet className="mr-1 h-4 w-4" />Record payment</Button>}
          <ExportButtons path={`/sales/${id}/statement`} name={`statement_${s.order_no}`} testid="statement" />
          <AdminActions entity="sales" row={s} testid="sale" onDone={(mode) => (mode === "delete" ? nav("/sales") : reload())} />
        </>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Panel title="Sale pricing (locked at sale)" className="lg:col-span-2" testid="sale-pricing">
          <Breakdown p={s.pricing} testid="sale-breakdown" />
          <div className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">PPF rolls</span>{s.qty ? <span className="font-mono" data-testid="sale-rolls">{s.qty} from {s.po_number} · {s.batch_no}</span> : <Link to={`/rolls/${s.roll_ref}`} className="font-mono text-amber-400 hover:underline">{s.roll_serial}</Link>}</div>
            <div className="flex justify-between"><span className="text-muted-foreground">Actually collected</span><span className="font-mono text-emerald-400" data-testid="sale-collected">{inr(s.collected)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Customer receivable</span><span className="font-mono text-amber-400" data-testid="sale-receivable">{inr(s.pricing.total - s.collected)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Wheelspa margin recognised</span><span className="font-mono">{inr(s.ws_recognized)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Terms applied</span><span className="font-mono text-xs">{s.pricing.lines.map((l) => `${l.agreement_version ? "v" + l.agreement_version : "default"} · ${l.margin_bp / 100}% / ${l.investor_share_bp / 100}%`).join(", ")}</span></div>
          </div>
        </Panel>
        <div className="space-y-6 lg:col-span-3">
          {d.settlements.map((st) => <SettlementCard key={st.id} st={st} transfers={d.transfers} saleId={id} reload={reload} />)}
          <Panel title="Customer collections">
            <DataTable testid="collections-table" rows={d.collections} empty="No customer payment received — principal is not yet recoverable" columns={[
              { key: "receipt_no", label: "Receipt", render: (r) => <span className="font-mono text-xs">{r.receipt_no}</span> }, { key: "date", label: "Date", render: (r) => fdate(r.date) },
              { key: "amount", label: "Amount", right: true, money: true }, { key: "mode", label: "Mode" }, { key: "reference", label: "Reference" },
              { key: "doc", label: "Proof", render: (r) => <DocButton id={r.doc_id} /> },
              { key: "act", label: "", render: (r) => <AdminActions entity="collections" row={r} onDone={reload} testid={`collection-${r.receipt_no}`} /> },
            ]} />
          </Panel>
        </div>
      </div>
      <Panel title="Ledger entries for this sale" className="mt-6">
        <DataTable testid="sale-ledger" rowKey="txn_id" rows={d.ledger} columns={[
          { key: "txn_id", label: "Txn", render: (r) => <span className="font-mono text-xs">{r.txn_id}</span> }, { key: "date", label: "Date", render: (r) => fdate(r.date) },
          { key: "type", label: "Type", render: (r) => <span className="font-mono text-xs">{r.type}</span> }, { key: "amount", label: "Amount", right: true, money: true },
          { key: "remarks", label: "Remarks" }, { key: "created_by", label: "By" },
        ]} />
      </Panel>
      {d.queries.length > 0 && <Panel title="Queries on this order" className="mt-6">
        {d.queries.map((q) => <div key={q.id} className="mb-2 flex items-center gap-2 text-sm"><StatusBadge status={q.status} /> <Link to="/queries" className="text-amber-400 hover:underline">{q.query_no}</Link> {q.subject}</div>)}
      </Panel>}
      <InvoiceDialog open={inv} setOpen={setInv} sale={s} done={reload} />
      <CollectionDialog open={col} setOpen={setCol} sale={s} done={reload} />
    </div>
  );
}
