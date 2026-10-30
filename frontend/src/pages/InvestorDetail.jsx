import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, DocButton, Field, FormDialog, Kpi, NSelect, PageHeader, Panel, StatusBadge, UploadField, run, useForm, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { AdminActions } from "@/components/AdminActions";
import { fdate, fdt, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

function InvestmentDialog({ open, setOpen, investorId, done }) {
  const [f, set] = useForm({ amount: "", date: todayIST(), bank_ref: "", doc_id: null, terms_note: "" });
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Record investment received" testid="investment-dialog"
      onSubmit={() => run(() => api.post("/investments", { ...f, investor_id: investorId }), "Investment recorded").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)"><Input data-testid="investment-amount-input" type="number" step="0.01" required value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Date of receipt"><Input data-testid="investment-date-input" type="date" required value={f.date} onChange={set("date")} /></Field>
      </div>
      <Field label="Bank transaction reference (UTR)"><Input data-testid="investment-ref-input" required value={f.bank_ref} onChange={set("bank_ref")} /></Field>
      <Field label="Agreed commercial terms note"><Input data-testid="investment-terms-input" value={f.terms_note} onChange={set("terms_note")} /></Field>
      <Field label="Payment proof"><UploadField testid="investment-proof-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

function TermsDialog({ open, setOpen, investorId, done }) {
  const [f, set] = useForm({ default_base_price: "", margin_pct: "30", income_tax_pct: "30", investor_share_pct: "50", gst_pct: "18", gst_mode: "full_value", settlement_days: "7", effective_from: todayIST(), notes: "" });
  const [avg] = useLoad(open ? `/investors/${investorId}/avg-cost` : null);
  const auto = avg && avg.avg !== null;
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Propose commercial terms" testid="terms-dialog"
      description="Requires management approval. Historical orders keep the terms that applied when they were confirmed."
      onSubmit={() => run(() => api.post(`/investors/${investorId}/agreements`, f), "Terms submitted for approval").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Average price per roll (₹)" hint={auto ? "Auto: average purchase value per roll, excluding GST" : "No purchases yet — enter manually"}>
          {auto ? <Input data-testid="terms-base-input" readOnly value={inr(avg.avg)} className="font-mono" />
            : <Input data-testid="terms-base-input" type="number" step="0.01" required value={f.default_base_price} onChange={set("default_base_price")} />}
        </Field>
        <Field label="Effective from"><Input data-testid="terms-effective-input" type="date" required value={f.effective_from} onChange={set("effective_from")} /></Field>
        <Field label="Combined margin %"><Input data-testid="terms-margin-input" type="number" step="0.01" value={f.margin_pct} onChange={set("margin_pct")} /></Field>
        <Field label="Income tax deducted from margin %"><Input data-testid="terms-tax-input" type="number" step="0.01" value={f.income_tax_pct} onChange={set("income_tax_pct")} /></Field>
        <Field label="Investor share of net margin %"><Input data-testid="terms-share-input" type="number" step="0.01" value={f.investor_share_pct} onChange={set("investor_share_pct")} /></Field>
        <Field label="GST %"><Input data-testid="terms-gst-input" type="number" step="0.01" value={f.gst_pct} onChange={set("gst_pct")} /></Field>
        <Field label="GST calculation method" hint="Confirm with the company's CA">
          <NSelect testid="terms-gst-mode-select" value={f.gst_mode} onChange={set("gst_mode")} options={[{ value: "full_value", label: "On full taxable value (base + margin)" }, { value: "margin_only", label: "On margin only" }]} />
        </Field>
        <Field label="Settlement due within (days of collection)"><Input data-testid="terms-days-input" type="number" value={f.settlement_days} onChange={set("settlement_days")} /></Field>
      </div>
      <Field label="Notes"><Input data-testid="terms-notes-input" value={f.notes} onChange={set("notes")} /></Field>
    </FormDialog>
  );
}

export default function InvestorDetail() {
  const { id } = useParams();
  const { can } = useMe();
  const [d, reload] = useLoad(`/investors/${id}`);
  const [inv, setInv] = useState(false);
  const [terms, setTerms] = useState(false);
  if (!d) return <div className="text-muted-foreground">Loading…</div>;
  const b = d.balances;
  const kpis = [["invested", "Principal invested", b.invested], ["allocated", "Allocated to rolls", b.allocated], ["available", "Available for procurement", b.available],
    ["deployed", "Deployed in inventory", b.deployed], ["recovered", "Principal recovered", b.recovered, "green"], ["repaid", "Principal repaid", b.repaid, "green"],
    ["outstanding", "Principal outstanding", b.outstanding, "amber"], ["ppt", "Recovered, pending transfer", b.principal_pending_transfer, b.principal_pending_transfer ? "amber" : "green"],
    ["me", "Margin earned", b.margin_earned, "green"], ["mpaid", "Margin paid", b.margin_paid, "green"], ["mp", "Margin payable", b.margin_payable, b.margin_payable ? "amber" : "green"],
    ["tt", "Total transferred", b.total_transferred, "green"]];
  const decide = (a, ok) => {
    const reason = ok ? "" : window.prompt("Reason for rejection");
    if (!ok && !reason) return;
    run(() => api.post(`/agreements/${a.id}/${ok ? "approve" : "reject"}`, ok ? {} : { reason }), ok ? "Terms approved" : "Terms rejected").then(reload);
  };
  return (
    <div>
      <PageHeader title={d.name} subtitle={`${d.code} · ${d.email}${d.bank_details ? " · " + d.bank_details : ""}`}
        actions={<>
          {can("record") && <Button data-testid="record-investment-btn" onClick={() => setInv(true)}><Plus className="mr-1 h-4 w-4" />Record investment</Button>}
          {can("propose") && <Button variant="outline" data-testid="propose-terms-btn" onClick={() => setTerms(true)}>Propose terms</Button>}
          <Button asChild variant="outline"><Link to={`/inventory?investor=${id}`} data-testid="view-funded-rolls">Funded rolls</Link></Button>
        </>} />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="investor-balances">
        {kpis.map(([k, l, v, t], i) => <Kpi key={k} i={i} item={{ key: `inv-${k}`, label: l, value: v, tone: t || "neutral" }} />)}
      </div>
      <Tabs defaultValue="investments">
        <TabsList><TabsTrigger value="investments" data-testid="tab-investments">Investments</TabsTrigger><TabsTrigger value="terms" data-testid="tab-terms">Commercial terms</TabsTrigger></TabsList>
        <TabsContent value="investments">
          <Panel>
            <DataTable testid="investments-table" rows={d.investments} columns={[
              { key: "date", label: "Date", render: (r) => fdate(r.date) }, { key: "ref_no", label: "Ref", render: (r) => <span className="font-mono">{r.ref_no}</span> },
              { key: "amount", label: "Amount", right: true, money: true }, { key: "bank_ref", label: "Bank ref", render: (r) => <span className="font-mono text-xs">{r.bank_ref}</span> },
              { key: "terms_note", label: "Terms" }, { key: "doc", label: "Proof", render: (r) => <DocButton id={r.doc_id} testid={`investment-proof-${r.ref_no}`} /> },
              { key: "act", label: "", render: (r) => <AdminActions entity="investments" row={r} onDone={reload} testid={`investment-${r.ref_no}`} /> },
            ]} />
          </Panel>
        </TabsContent>
        <TabsContent value="terms">
          <Panel>
            <DataTable testid="terms-table" rows={d.agreements} columns={[
              { key: "version", label: "Ver", render: (r) => <span className="font-mono">v{r.version}</span> },
              { key: "effective_from", label: "Effective", render: (r) => fdate(r.effective_from) },
              { key: "base", label: "Base / roll", right: true, render: (r) => inr(r.default_base_price) },
              { key: "m", label: "Margin · tax · investor share", render: (r) => `${r.margin_bp / 100}% · ${(r.tax_bp || 0) / 100}% · ${r.investor_share_bp / 100}%` },
              { key: "g", label: "GST", render: (r) => `${r.gst_bp / 100}% ${r.gst_mode === "full_value" ? "on full value" : "on margin"}` },
              { key: "settlement_days", label: "Settle in", render: (r) => `${r.settlement_days} d` },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "by", label: "Proposed / approved", render: (r) => <span className="text-xs text-muted-foreground">{r.created_by}{r.approved_by ? ` → ${r.approved_by} ${fdt(r.approved_at)}` : ""}</span> },
              { key: "act", label: "", render: (r) => r.status === "pending" && can("approve") && (
                <div className="flex gap-1">
                  <Button size="sm" data-testid={`approve-terms-v${r.version}`} onClick={() => decide(r, true)}><Check className="h-4 w-4" /></Button>
                  <Button size="sm" variant="outline" data-testid={`reject-terms-v${r.version}`} onClick={() => decide(r, false)}><X className="h-4 w-4" /></Button>
                </div>) },
            ]} />
          </Panel>
        </TabsContent>
      </Tabs>
      <InvestmentDialog open={inv} setOpen={setInv} investorId={id} done={reload} />
      <TermsDialog open={terms} setOpen={setTerms} investorId={id} done={reload} />
    </div>
  );
}
