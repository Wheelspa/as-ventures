import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, Field, FormDialog, PageHeader, Panel, run, useForm, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { AdminActions } from "@/components/AdminActions";
import { useMe } from "@/lib/me";

function AddInvestor({ open, setOpen, done }) {
  const [f, set] = useForm({ name: "", email: "", phone: "", pan: "", bank_details: "" });
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Add investor" testid="add-investor-dialog"
      onSubmit={() => run(() => api.post("/investors", f), "Investor created").then((r) => { if (r) done(); return r; })}>
      <Field label="Investor name"><Input data-testid="investor-name-input" required value={f.name} onChange={set("name")} /></Field>
      <Field label="Email (used for portal access)"><Input data-testid="investor-email-input" type="email" required value={f.email} onChange={set("email")} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone"><Input data-testid="investor-phone-input" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="PAN"><Input data-testid="investor-pan-input" value={f.pan} onChange={set("pan")} /></Field>
      </div>
      <Field label="Bank details for repayments"><Input data-testid="investor-bank-input" value={f.bank_details} onChange={set("bank_details")} /></Field>
    </FormDialog>
  );
}

export default function Investors() {
  const { can } = useMe();
  const [rows, reload] = useLoad("/investors");
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader title="Investors" subtitle="Separate capital accounts, ledgers and commercial terms for each investor."
        actions={can("users") && <Button data-testid="add-investor-btn" onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" />Add investor</Button>} />
      <Panel>
        <DataTable testid="investors-table" rows={rows} columns={[
          { key: "code", label: "Code", render: (r) => <span className="font-mono">{r.code}</span> },
          { key: "name", label: "Investor", render: (r) => <Link data-testid={`investor-link-${r.code}`} className="font-semibold text-amber-400 hover:underline" to={`/investors/${r.id}`}>{r.name}</Link> },
          { key: "inv", label: "Invested", right: true, render: (r) => fmt(r.balances.invested) },
          { key: "av", label: "Available", right: true, render: (r) => fmt(r.balances.available) },
          { key: "dep", label: "In inventory", right: true, render: (r) => fmt(r.balances.deployed) },
          { key: "out", label: "Principal outstanding", right: true, render: (r) => fmt(r.balances.outstanding) },
          { key: "mp", label: "Margin payable", right: true, render: (r) => fmt(r.balances.margin_payable) },
          { key: "act", label: "", render: (r) => <AdminActions entity="investors" row={r} onDone={reload} testid={`investor-${r.code}`} /> },
        ]} />
      </Panel>
      <AddInvestor open={open} setOpen={setOpen} done={reload} />
    </div>
  );
}

const fmt = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(v / 100);
