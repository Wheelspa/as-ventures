import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, DocButton, Field, FormDialog, NSelect, PageHeader, Panel, StatusBadge, UploadField, run, useForm, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { AdminActions } from "@/components/AdminActions";
import { fdate, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

const ITEM = { brand: "", series: "", thickness: "", specs: "", qty: "1", unit_cost: "", gst_pct: "18" };

const ItemRow = ({ it, i, setItem, remove }) => (
  <div className="grid grid-cols-2 gap-2 border-b border-border/40 pb-3 sm:grid-cols-4" data-testid={`purchase-item-${i}`}>
    <Field label="PPF brand"><Input data-testid={`item-brand-${i}`} required value={it.brand} onChange={(e) => setItem(i, "brand", e.target.value)} /></Field>
    <Field label="Series"><Input data-testid={`item-series-${i}`} value={it.series} onChange={(e) => setItem(i, "series", e.target.value)} /></Field>
    <Field label="Thickness"><Input data-testid={`item-thickness-${i}`} placeholder="8.5 mil" value={it.thickness} onChange={(e) => setItem(i, "thickness", e.target.value)} /></Field>
    <Field label="Specs"><Input data-testid={`item-specs-${i}`} placeholder="1.52 m x 15 m" value={it.specs} onChange={(e) => setItem(i, "specs", e.target.value)} /></Field>
    <Field label="Rolls"><Input data-testid={`item-qty-${i}`} type="number" min="1" required value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} /></Field>
    <Field label="Cost/roll ₹ (excl. GST)"><Input data-testid={`item-cost-${i}`} type="number" step="0.01" required value={it.unit_cost} onChange={(e) => setItem(i, "unit_cost", e.target.value)} /></Field>
    <Field label="GST %"><Input data-testid={`item-gst-${i}`} type="number" step="0.01" value={it.gst_pct} onChange={(e) => setItem(i, "gst_pct", e.target.value)} /></Field>
    <div className="flex items-end justify-between gap-1 pb-1">
      <span className="font-mono text-xs" data-testid={`item-subtotal-${i}`}>{inr(Math.round((+it.qty || 0) * (+it.unit_cost || 0) * 100))}</span>
      {remove && <Button type="button" size="icon" variant="ghost" data-testid={`item-remove-${i}`} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>}
    </div>
  </div>
);

function PurchaseDialog({ open, setOpen, done }) {
  const [investors] = useLoad("/investors");
  const [f, set, setF] = useForm({ supplier: "", supplier_invoice: "", purchase_date: todayIST(), items: [{ ...ITEM }],
    other_charges: "0", amount_paid: "0", invoice_doc_id: null, payment_doc_id: null, funding: [{ investor_id: "", pct: "100" }] });
  useEffect(() => {
    if (investors?.length && !f.funding[0].investor_id) setF((p) => ({ ...p, funding: [{ investor_id: investors[0].id, pct: "100" }] }));
  }, [investors]); // eslint-disable-line react-hooks/exhaustive-deps
  const setFund = (i, k, v) => setF((p) => ({ ...p, funding: p.funding.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const setItem = (i, k, v) => setF((p) => ({ ...p, items: p.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const removeItem = (i) => setF((p) => ({ ...p, items: p.items.filter((_, j) => j !== i) }));
  const subtotal = f.items.reduce((a, it) => a + (+it.unit_cost || 0) * (+it.qty || 0), 0);
  const gst = f.items.reduce((a, it) => a + (+it.unit_cost || 0) * (+it.qty || 0) * (+it.gst_pct || 0) / 100, 0);
  const total = subtotal + gst + (+f.other_charges || 0);
  const principal = subtotal + (+f.other_charges || 0);
  const rolls = f.items.reduce((a, it) => a + (+it.qty || 0), 0);
  const opts = (investors || []).map((i) => ({ value: i.id, label: `${i.name} · avail ${inr(i.balances.available)}` }));
  return (
    <FormDialog wide open={open} onOpenChange={setOpen} title="Log purchase invoice" testid="purchase-dialog" submitLabel="Record purchase & allocate funds"
      description="Add every product on the supplier invoice. Each product gets its own batch number."
      onSubmit={() => run(() => api.post("/purchases", f), "Purchase recorded, rolls added to inventory").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier"><Input data-testid="purchase-supplier-input" required value={f.supplier} onChange={set("supplier")} /></Field>
        <Field label="Supplier invoice no."><Input data-testid="purchase-invoice-input" required value={f.supplier_invoice} onChange={set("supplier_invoice")} /></Field>
        <Field label="Purchase date"><Input data-testid="purchase-date-input" type="date" required value={f.purchase_date} onChange={set("purchase_date")} /></Field>
      </div>
      <div className="space-y-3 rounded-lg border border-border/60 p-3">
        <div className="text-sm font-semibold">Products on this invoice</div>
        {f.items.map((it, i) => <ItemRow key={i} it={it} i={i} setItem={setItem} remove={f.items.length > 1 && removeItem} />)}
        <Button type="button" size="sm" variant="outline" data-testid="add-item-btn" onClick={() => setF((p) => ({ ...p, items: [...p.items, { ...ITEM }] }))}><Plus className="mr-1 h-4 w-4" />Add product</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Other charges on invoice (₹)" hint="Split across products by value"><Input data-testid="purchase-other-input" type="number" step="0.01" value={f.other_charges} onChange={set("other_charges")} /></Field>
        <Field label="Paid to supplier now (₹)"><Input data-testid="purchase-paid-input" type="number" step="0.01" value={f.amount_paid} onChange={set("amount_paid")} /></Field>
      </div>
      <div className="rounded-lg border border-border/60 p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">Investor funding allocation
          <Button type="button" size="sm" variant="ghost" data-testid="add-funding-row" onClick={() => setF((p) => ({ ...p, funding: [...p.funding, { investor_id: "", pct: "" }] }))}><Plus className="h-4 w-4" /></Button>
        </div>
        {f.funding.map((x, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <NSelect testid={`funding-investor-${i}`} value={x.investor_id} onChange={(v) => setFund(i, "investor_id", v)} options={opts} placeholder="Select investor" />
            <Input data-testid={`funding-pct-${i}`} className="w-24" type="number" step="0.01" value={x.pct} onChange={(e) => setFund(i, "pct", e.target.value)} />
            <span className="self-center text-xs text-muted-foreground">%</span>
            {f.funding.length > 1 && <Button type="button" size="icon" variant="ghost" onClick={() => setF((p) => ({ ...p, funding: p.funding.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier invoice"><UploadField testid="purchase-invoice-upload" value={f.invoice_doc_id} onChange={set("invoice_doc_id")} /></Field>
        <Field label="Supplier payment proof"><UploadField testid="purchase-payment-upload" value={f.payment_doc_id} onChange={set("payment_doc_id")} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-amber-500/5 p-3 font-mono text-xs sm:grid-cols-3" data-testid="purchase-preview">
        <div>Invoice total ({rolls} rolls)<div className="text-base font-bold">{inr(Math.round(total * 100))}</div></div>
        <div>Investor capital allocated (excl. GST)<div className="text-base font-bold text-amber-400">{inr(Math.round(principal * 100))}</div></div>
        <div>GST on purchase<div className="text-base font-bold">{inr(Math.round(gst * 100))}</div></div>
      </div>
    </FormDialog>
  );
}

function PaymentDialog({ p, setP, done }) {
  const [f, set] = useForm({ amount: "", date: todayIST(), reference: "", doc_id: null });
  return (
    <FormDialog open={!!p} onOpenChange={() => setP(null)} title={`Supplier payment · ${p?.po_number}`} testid="supplier-payment-dialog"
      description={p && `Balance due ${inr(p.total - p.amount_paid)}`}
      onSubmit={() => run(() => api.post(`/purchases/${p.id}/payments`, f), "Supplier payment recorded").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)"><Input data-testid="supplier-payment-amount" type="number" step="0.01" required value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Date"><Input type="date" required value={f.date} onChange={set("date")} /></Field>
      </div>
      <Field label="Bank reference"><Input data-testid="supplier-payment-ref" required value={f.reference} onChange={set("reference")} /></Field>
      <Field label="Proof"><UploadField testid="supplier-payment-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

export default function Purchases() {
  const { can } = useMe();
  const [sp] = useSearchParams();
  const [rows, reload] = useLoad("/purchases");
  const [open, setOpen] = useState(sp.get("new") === "1");
  const [pay, setPay] = useState(null);
  return (
    <div>
      <PageHeader title="Purchases" subtitle="PPF roll procurement, supplier invoices and the investor capital allocated to each batch."
        actions={can("record") && <Button data-testid="new-purchase-btn" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Log purchase invoice</Button>} />
      <Panel>
        <DataTable testid="purchases-table" rows={rows} columns={[
          { key: "po_number", label: "PO · Batch", render: (r) => <div><Link className="font-mono text-amber-400 hover:underline" to={`/inventory?purchase=${r.id}`}>{r.po_number}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.batch_no || "—"}</div></div> },
          { key: "purchase_date", label: "Date", render: (r) => fdate(r.purchase_date) },
          { key: "supplier", label: "Supplier", render: (r) => <div>{r.supplier}<div className="font-mono text-[11px] text-muted-foreground">{r.supplier_invoice}</div></div> },
          { key: "prod", label: "Product", render: (r) => <div>{r.brand} {r.series}<div className="text-[11px] text-muted-foreground">{r.thickness} {r.specs}</div></div> },
          { key: "qty", label: "Qty", right: true },
          { key: "total", label: "Procurement total", right: true, money: true },
          { key: "principal_allocated", label: "Capital allocated", right: true, money: true },
          { key: "funding", label: "Funded by", render: (r) => r.funding.map((x) => `${x.investor_name} ${x.pct_bp / 100}%`).join(", ") },
          { key: "payment_status", label: "Supplier payment", render: (r) => <div className="space-y-1"><StatusBadge status={r.payment_status} /><div className="font-mono text-[11px] text-muted-foreground">{inr(r.amount_paid)} paid</div></div> },
          { key: "docs", label: "Docs", render: (r) => <div className="flex flex-col"><DocButton id={r.invoice_doc_id} label="Invoice" /><DocButton id={r.payment_doc_id} label="Payment" /></div> },
          { key: "act", label: "", render: (r) => <div className="flex items-center gap-1">{can("record") && r.payment_status !== "paid" && <Button size="sm" variant="outline" data-testid={`pay-supplier-${r.po_number}`} onClick={() => setPay(r)}>Record payment</Button>}<AdminActions entity="purchases" row={r} onDone={reload} testid={`purchase-${r.po_number}`} /></div> },
        ]} />
      </Panel>
      <PurchaseDialog open={open} setOpen={setOpen} done={reload} />
      <PaymentDialog p={pay} setP={setPay} done={reload} />
    </div>
  );
}
