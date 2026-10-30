import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormDialog, run } from "@/components/common";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me";

const T = (key, label, type = "text") => ({ key, label, type });
const M = (key, label) => ({ key, label, type: "number", money: true });

export const EDIT_FIELDS = {
  investors: [T("name", "Investor name"), T("email", "Email"), T("phone", "Phone"), T("pan", "PAN"), T("bank_details", "Bank details")],
  investments: [M("amount", "Amount (₹)"), T("date", "Date of receipt", "date"), T("bank_ref", "Bank reference"), T("terms_note", "Terms note")],
  purchases: [T("po_number", "PO number"), T("supplier", "Supplier"), T("supplier_invoice", "Supplier invoice no."), T("purchase_date", "Purchase date", "date"),
    T("brand", "Brand"), T("series", "Series"), T("thickness", "Thickness"), T("specs", "Specifications"), M("unit_cost", "Supplier cost per roll (₹)"),
    { key: "gst_pct", label: "GST on purchase %", type: "number" }, M("other_charges", "Other charges (₹)"), M("amount_paid", "Paid to supplier (₹)")],
  rolls: [T("roll_id", "Roll ID / serial"), T("brand", "Brand"), T("series", "Series"), T("thickness", "Thickness"), T("specs", "Specifications")],
  sales: [T("customer_name", "Customer name"), T("customer_code", "Customer code"), T("vehicle", "Vehicle"), T("remarks", "Remarks"), T("invoice_no", "Invoice number"), T("invoice_date", "Invoice date", "date")],
  collections: [M("amount", "Amount received (₹)"), T("date", "Date", "date"), T("mode", "Mode"), T("reference", "Payment reference")],
  transfers: [M("amount", "Amount (₹)"), T("date", "Transfer date", "date"), T("bank_ref", "Bank reference (UTR)")],
};

const initial = (entity, row) =>
  Object.fromEntries(EDIT_FIELDS[entity].map((f) => [f.key, f.money ? ((row[f.key] || 0) / 100).toFixed(2) : String(row[f.key] ?? "")]));

function EditDialog({ entity, row, open, setOpen, onDone, testid }) {
  const [init] = useState(() => initial(entity, row));
  const [vals, setVals] = useState(init);
  const [reason, setReason] = useState("");
  const submit = () => {
    const fields = Object.fromEntries(Object.entries(vals).filter(([k, v]) => v !== init[k]));
    return run(() => api.patch(`/admin/${entity}/${row.id}`, { fields, reason }), "Changes saved — original values kept in the audit trail").then((r) => { if (r) onDone?.("edit"); return r; });
  };
  return (
    <FormDialog wide open={open} onOpenChange={setOpen} title="Edit record" testid={`${testid}-edit-dialog`} submitLabel="Save changes" onSubmit={submit}
      description="Amount changes post correcting ledger entries and recalculate balances. Every change is logged with the reason.">
      <div className="grid gap-3 sm:grid-cols-2">
        {EDIT_FIELDS[entity].map((f) => (
          <Field key={f.key} label={f.label}>
            <Input data-testid={`${testid}-edit-${f.key}`} type={f.type} step={f.type === "number" ? "0.01" : undefined} value={vals[f.key]}
              onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <Field label="Reason for change (required)"><Input data-testid={`${testid}-edit-reason`} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormDialog>
  );
}

function RemoveDialog({ entity, row, open, setOpen, onDone, testid }) {
  const [mode, setMode] = useState("void");
  const [reason, setReason] = useState("");
  const submit = () => run(() => api.post(`/admin/${entity}/${row.id}/remove`, { mode, reason }), mode === "void" ? "Record voided" : "Record permanently deleted")
    .then((r) => { if (r) onDone?.(mode); return r; });
  return (
    <FormDialog open={open} onOpenChange={setOpen} title="Remove record" testid={`${testid}-remove-dialog`} onSubmit={submit} submitLabel={mode === "void" ? "Void record" : "Delete permanently"}
      description="Balances are reversed with correcting ledger entries. Only allowed when nothing depends on this record.">
      <div className="grid gap-2">
        {[["void", "Void with a reason", "Hidden from lists and totals; kept in the audit trail."], ["delete", "Permanent delete", "Erased for good; only the audit log records that it existed."]].map(([v, l, d]) => (
          <label key={v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${mode === v ? "border-amber-500/50 bg-amber-500/5" : "border-border/60"}`}>
            <input type="radio" data-testid={`${testid}-remove-mode-${v}`} checked={mode === v} onChange={() => setMode(v)} />
            <span><span className="block text-sm font-semibold">{l}</span><span className="text-xs text-muted-foreground">{d}</span></span>
          </label>
        ))}
      </div>
      <Field label="Reason (required)"><Input data-testid={`${testid}-remove-reason`} required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormDialog>
  );
}

export function AdminActions({ entity, row, onDone, canRemove = true, testid }) {
  const { can } = useMe();
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!can("edit") || row.voided || row.status === "voided") return null;
  const id = testid || `${entity}-${row.id}`;
  const remove = async () => {
    setBusy(true);
    const r = await run(() => api.post(`/admin/${entity}/${row.id}/remove`, { mode: "delete", reason: "Deleted by Super Admin" }), "Deleted");
    setBusy(false);
    if (r) onDone?.("delete");
  };
  return (
    <span className="inline-flex gap-1">
      <Button size="icon" variant="ghost" className="h-8 w-8" data-testid={`${id}-edit-btn`} title="Edit" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /></Button>
      {canRemove && <Button size="icon" variant="ghost" className="h-8 w-8 text-red-400 hover:text-red-300" data-testid={`${id}-delete-btn`} title="Delete" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" /></Button>}
      {edit && <EditDialog entity={entity} row={row} open={edit} setOpen={setEdit} onDone={onDone} testid={id} />}
    </span>
  );
}
