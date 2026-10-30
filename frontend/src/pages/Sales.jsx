import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, Field, FormDialog, NSelect, PageHeader, Panel, StatusBadge, run, useForm, useLoad } from "@/components/common";
import { api, errMsg } from "@/lib/api";
import { fdate, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

export const Breakdown = ({ p, testid = "pricing-breakdown" }) => {
  const rows = [["Agreed base price (principal)", p.base], [`Combined margin`, p.margin], [`  Less income tax @ ${(p.tax_bp || 0) / 100}%`, p.income_tax || 0, "text-red-400"],
    ["  Net margin for distribution", p.net_margin ?? p.margin], ["  Investor share", p.investor_margin, "text-amber-400"], ["  Wheelspa share", p.wheelspa_margin, "text-emerald-400"],
    ["Taxable selling value", p.taxable], [`GST @ ${p.gst_bp / 100}% (${p.gst_mode === "full_value" ? "on taxable value" : "on margin"}) — not distributable`, p.gst, "text-slate-400"], ["Total customer invoice", p.total, "font-bold text-base"]];
  return (
    <div data-testid={testid} className="divide-y divide-border/40 rounded-lg border border-border/60 font-mono text-sm">
      {rows.map(([l, v, c]) => (
        <div key={l} className={`flex justify-between gap-4 px-3 py-2 ${c || ""}`}><span className="whitespace-pre-wrap font-sans text-xs sm:text-sm">{l}</span><span className="shrink-0" data-testid={`${testid}-${l.trim().split(" ")[0].toLowerCase()}`}>{inr(v)}</span></div>
      ))}
    </div>
  );
};

function SaleDialog({ open, setOpen, done }) {
  const [batches] = useLoad(open ? "/stock/batches" : null);
  const [f, set] = useForm({ purchase_id: "", qty: "1", customer_name: "", customer_code: "", vehicle: "", sale_date: todayIST(), margin_pct: "30", invoice_no: "", amount_received: "", payment_reference: "", payment_mode: "Bank transfer", remarks: "" });
  const [pv, setPv] = useState(null);
  const [pvErr, setPvErr] = useState("");
  const batch = (batches || []).find((b) => b.purchase_id === f.purchase_id);
  const qty = parseInt(f.qty, 10) || 0;
  const margin = f.margin_pct === "" ? null : Number(f.margin_pct);
  useEffect(() => {
    if (!f.purchase_id || qty < 1) { setPv(null); return; }
    api.post("/pricing/preview", { purchase_id: f.purchase_id, qty, sale_date: f.sale_date, margin_pct: margin }).then((r) => { setPv(r.data.pricing); setPvErr(""); }).catch((e) => { setPv(null); setPvErr(errMsg(e)); });
  }, [f.purchase_id, qty, f.sale_date, margin]);
  useEffect(() => {
    if (pv) { set("amount_received")((pv.total / 100).toFixed(2)); }
  }, [pv?.total]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => run(() => api.post("/sales", { ...f, qty, margin_pct: margin, amount_received: f.amount_received ? Number(f.amount_received) : null }), "Sale recorded").then((r) => { if (r) done(r); return r; });
  return (
    <FormDialog wide open={open} onOpenChange={setOpen} title="New sale" testid="sale-dialog" submitLabel="Record sale"
      description="Pick the purchase batch and how many rolls you sold. Price = purchase value (excl. GST) + your margin + GST." onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Purchase batch (in stock)"><NSelect testid="sale-batch-select" value={f.purchase_id} onChange={set("purchase_id")} placeholder="Select a batch"
          options={(batches || []).map((b) => ({ value: b.purchase_id, label: `${b.po_number} · ${b.brand} ${b.series} · ${b.available} in stock` }))} /></Field>
        <Field label={`Number of rolls${batch ? ` (max ${batch.available})` : ""}`}><Input data-testid="sale-qty-input" type="number" min={1} max={batch?.available} required value={f.qty} onChange={set("qty")} /></Field>
        <Field label="Sale date"><Input data-testid="sale-date-input" type="date" required value={f.sale_date} onChange={set("sale_date")} /></Field>
        <Field label="Margin on purchase value (%)"><Input data-testid="sale-margin-input" type="number" step="0.01" min={0} required value={f.margin_pct} onChange={set("margin_pct")} /></Field>
        <Field label="Invoice number (blank = auto)"><Input data-testid="sale-invoice-no-input" value={f.invoice_no} onChange={set("invoice_no")} /></Field>
        <Field label="Customer name"><Input data-testid="sale-customer-input" required value={f.customer_name} onChange={set("customer_name")} /></Field>
        <Field label="Customer code"><Input data-testid="sale-customer-code-input" value={f.customer_code} onChange={set("customer_code")} /></Field>
        <Field label="Vehicle"><Input data-testid="sale-vehicle-input" value={f.vehicle} onChange={set("vehicle")} /></Field>
        <Field label="Remarks"><Input data-testid="sale-remarks-input" value={f.remarks} onChange={set("remarks")} /></Field>
      </div>
      <PaymentNow f={f} set={set} total={pv?.total} />
      <div className="rounded-lg bg-amber-500/5 p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">{qty > 0 ? `Total for ${qty} roll${qty > 1 ? "s" : ""} · ` : ""}base + {f.margin_pct || 0}% margin + GST · 30% income tax deducted from margin, balance split 50:50</div>
        {pv ? <Breakdown p={pv} testid="sale-preview" /> : <div className="text-sm text-muted-foreground" data-testid="sale-preview-empty">{pvErr || "Select a batch and quantity to calculate."}</div>}
      </div>
    </FormDialog>
  );
}

const PaymentNow = ({ f, set, total }) => (
  <div className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-3">
    <Field label="Amount received now (₹, auto-filled, edit or clear)"><div className="flex gap-1"><Input data-testid="sale-amount-received-input" type="number" step="0.01" min={0} value={f.amount_received} onChange={set("amount_received")} />
      {total > 0 && <Button type="button" variant="ghost" size="sm" data-testid="sale-fill-full" onClick={() => set("amount_received")((total / 100).toFixed(2))}>Full</Button>}</div></Field>
    <Field label="Payment reference"><Input data-testid="sale-payment-ref-input" required={!!f.amount_received} value={f.payment_reference} onChange={set("payment_reference")} /></Field>
    <Field label="Mode"><Input data-testid="sale-payment-mode-input" value={f.payment_mode} onChange={set("payment_mode")} /></Field>
  </div>
);

const FILTERS = [["", "All"], ["reserved", "Reserved"], ["invoiced,partially_paid", "Unpaid"], ["paid", "Paid"], ["cancelled", "Cancelled"]];

export default function Sales() {
  const { can } = useMe();
  const [sp] = useSearchParams();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, reload] = useLoad("/sales", { status: status || undefined, q: q || undefined, date_from: from || undefined, date_to: to || undefined });
  const [open, setOpen] = useState(sp.get("new") === "1");
  return (
    <div>
      <PageHeader title="Sales" subtitle="Record a sale of one or many rolls from a purchase batch. Customer payments drive principal recovery sale by sale."
        actions={can("record") && <Button data-testid="new-sale-btn" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />New sale</Button>} />
      <Panel title={<div className="flex flex-wrap gap-1">{FILTERS.map(([v, l]) => (
        <button key={l} data-testid={`sales-filter-${l.toLowerCase()}`} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1 text-xs font-medium ${status === v ? "bg-amber-600 text-black" : "border border-border/60 text-muted-foreground"}`}>{l}</button>))}</div>}
        actions={<><Input data-testid="sales-search" placeholder="Search sale, customer, batch…" className="w-56" value={q} onChange={(e) => setQ(e.target.value)} />
          <Input type="date" className="w-40" data-testid="sales-from" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" className="w-40" data-testid="sales-to" value={to} onChange={(e) => setTo(e.target.value)} /></>}>
        <DataTable testid="sales-table" rows={rows} columns={[
          { key: "order_no", label: "Sale", render: (r) => <Link data-testid={`sale-link-${r.order_no}`} className="font-mono text-amber-400 hover:underline" to={`/sales/${r.id}`}>{r.order_no}</Link> },
          { key: "order_date", label: "Date", render: (r) => fdate(r.order_date) },
          { key: "customer_name", label: "Customer", render: (r) => <div>{r.customer_name}<div className="text-[11px] text-muted-foreground">{r.vehicle}</div></div> },
          { key: "roll_serial", label: "Rolls", render: (r) => <span className="font-mono text-xs">{r.qty ? r.roll_serial : `1 roll · ${r.roll_serial}`}</span> },
          { key: "base", label: "Base", right: true, render: (r) => inr(r.pricing.base) },
          { key: "gst", label: "GST", right: true, render: (r) => inr(r.pricing.gst) },
          { key: "total", label: "Invoice", right: true, render: (r) => inr(r.pricing.total) },
          { key: "collected", label: "Collected", right: true, money: true },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} testid={`sale-status-${r.order_no}`} /> },
        ]} />
      </Panel>
      <SaleDialog open={open} setOpen={setOpen} done={reload} />
    </div>
  );
}
