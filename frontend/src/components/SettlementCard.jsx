import { useState } from "react";
import { Check, MessageSquare, Upload, X, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, DocButton, Field, FormDialog, NSelect, Panel, StatusBadge, UploadField, run, useForm } from "@/components/common";
import { api } from "@/lib/api";
import { AdminActions } from "@/components/AdminActions";
import { fdate, fdt, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

function TransferDialog({ st, setSt, done }) {
  const [f, set] = useForm({ kind: "principal", amount: "", date: todayIST(), bank_ref: "", doc_id: null });
  const max = st ? (f.kind === "principal" ? st.principal_recoverable - st.principal_committed : st.margin_recoverable - st.margin_committed) : 0;
  return (
    <FormDialog open={!!st} onOpenChange={() => setSt(null)} title="Upload investor transfer proof" testid="transfer-dialog"
      description={`Transfers can only cover amounts actually collected. Available for ${f.kind}: ${inr(max)}`}
      onSubmit={() => run(() => api.post(`/settlements/${st.id}/transfers`, f), "Transfer proof uploaded — awaiting verification").then((r) => { if (r) done(); return r; })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Transfer type"><NSelect testid="transfer-kind-select" value={f.kind} onChange={set("kind")} options={[{ value: "principal", label: "Principal repayment" }, { value: "margin", label: "Investor margin payment" }]} /></Field>
        <Field label="Amount (₹)"><div className="flex gap-1"><Input data-testid="transfer-amount-input" type="number" step="0.01" required value={f.amount} onChange={set("amount")} />
          <Button type="button" variant="ghost" size="sm" data-testid="transfer-fill-max" onClick={() => set("amount")((max / 100).toFixed(2))}>Max</Button></div></Field>
        <Field label="Transfer date"><Input data-testid="transfer-date-input" type="date" required value={f.date} onChange={set("date")} /></Field>
        <Field label="Bank reference (UTR)"><Input data-testid="transfer-ref-input" required value={f.bank_ref} onChange={set("bank_ref")} /></Field>
      </div>
      <Field label="Bank transfer proof (required)"><UploadField testid="transfer-proof-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

function QueryDialog({ st, setSt, saleId, done }) {
  const [f, set] = useForm({ subject: "", message: "", doc_id: null });
  return (
    <FormDialog open={!!st} onOpenChange={() => setSt(null)} title={`Raise a query · ${st?.order_no}`} testid="query-dialog"
      onSubmit={() => run(() => api.post("/queries", { ...f, sale_id: saleId, settlement_id: st.id }), "Query sent to Wheelspa").then((r) => { if (r) done(); return r; })}>
      <Field label="Subject"><Input data-testid="query-subject-input" required value={f.subject} onChange={set("subject")} /></Field>
      <Field label="Details"><textarea data-testid="query-message-input" required className="nselect h-24 py-2" value={f.message} onChange={set("message")} /></Field>
      <Field label="Attachment"><UploadField testid="query-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
    </FormDialog>
  );
}

const Row = ({ l, v, c = "" }) => <div className="flex justify-between gap-3 py-1 text-sm"><span className="text-muted-foreground">{l}</span><span className={`font-mono ${c}`}>{v}</span></div>;

export function SettlementCard({ st, transfers, saleId, reload }) {
  const { can } = useMe();
  const [tr, setTr] = useState(null);
  const [qy, setQy] = useState(null);
  const mine = transfers.filter((t) => t.settlement_id === st.id);
  const verify = (t) => run(() => api.post(`/transfers/${t.id}/verify`), "Transfer verified and posted to ledger").then(reload);
  const reject = (t) => { const reason = window.prompt("Reason for rejecting this proof"); if (reason) run(() => api.post(`/transfers/${t.id}/reject`, { reason }), "Transfer rejected").then(reload); };
  const ack = () => run(() => api.post(`/settlements/${st.id}/ack`, { note: window.prompt("Acknowledgement note (optional)") || "" }), "Settlement acknowledged").then(reload);
  return (
    <Panel testid={`settlement-${st.settlement_no}`} title={<span className="flex flex-wrap items-center gap-2">{st.settlement_no} · {st.investor_name} <StatusBadge status={st.status} testid={`settlement-status-${st.settlement_no}`} />{st.open_query && <StatusBadge status="open" label="Query open" />}</span>}
      actions={<>
        {can("transfer") && st.status !== "settled" && (st.principal_recoverable - st.principal_committed + st.margin_recoverable - st.margin_committed) > 0 && <Button size="sm" data-testid={`upload-transfer-${st.settlement_no}`} onClick={() => setTr(st)}><Upload className="mr-1 h-4 w-4" />Upload transfer proof</Button>}
        {can("ack") && st.principal_paid + st.margin_paid > 0 && <Button size="sm" variant="outline" data-testid={`ack-${st.settlement_no}`} onClick={ack}><ThumbsUp className="mr-1 h-4 w-4" />Acknowledge</Button>}
        {can("query") && <Button size="sm" variant="outline" data-testid={`raise-query-${st.settlement_no}`} onClick={() => setQy(st)}><MessageSquare className="mr-1 h-4 w-4" />Raise query</Button>}
      </>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">Principal (return of capital)</div>
          <Row l="Principal attributable to roll" v={inr(st.principal_due)} />
          <Row l="Recoverable from collections" v={inr(st.principal_recoverable)} />
          <Row l="Repaid (verified)" v={inr(st.principal_paid)} c="text-emerald-400" />
          <Row l="Outstanding" v={inr(st.outstanding_principal)} c={st.outstanding_principal ? "text-amber-400" : ""} />
        </div>
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">Investor margin (profit)</div>
          <Row l="Margin share" v={inr(st.margin_due)} />
          <Row l="Earned on collections" v={inr(st.margin_recoverable)} />
          <Row l="Paid (verified)" v={inr(st.margin_paid)} c="text-emerald-400" />
          <Row l="Outstanding" v={inr(st.outstanding_margin)} c={st.outstanding_margin ? "text-amber-400" : ""} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Due: <b className={st.status === "overdue" ? "text-red-400" : "text-foreground"}>{fdate(st.due_date)}</b></span>
        <span>Total to investor: <b className="font-mono text-foreground">{inr(st.principal_paid + st.margin_paid)}</b> of {inr(st.principal_due + st.margin_due)}</span>
        {st.ack && <span data-testid={`ack-info-${st.settlement_no}`} className="text-emerald-400">Acknowledged by {st.ack.by} · {fdt(st.ack.at)} {st.ack.note && `— “${st.ack.note}”`}</span>}
      </div>
      <div className="mt-4">
        <DataTable testid={`transfers-${st.settlement_no}`} rows={mine} empty="No transfers recorded yet" columns={[
          { key: "transfer_no", label: "Transfer", render: (t) => <span className="font-mono text-xs">{t.transfer_no}</span> },
          { key: "kind", label: "Type", render: (t) => (t.kind === "principal" ? "Principal repayment" : "Margin payment") },
          { key: "amount", label: "Amount", right: true, money: true },
          { key: "date", label: "Date", render: (t) => fdate(t.date) },
          { key: "bank_ref", label: "UTR", render: (t) => <span className="font-mono text-xs">{t.bank_ref}</span> },
          { key: "doc", label: "Proof", render: (t) => <DocButton id={t.doc_id} testid={`transfer-proof-${t.transfer_no}`} /> },
          { key: "status", label: "Status", render: (t) => <div><StatusBadge status={t.status} testid={`transfer-status-${t.transfer_no}`} />{t.verified_by && <div className="mt-1 text-[10px] text-muted-foreground">by {t.verified_by}</div>}{t.reject_reason && <div className="mt-1 text-[10px] text-red-400">{t.reject_reason}</div>}</div> },
          { key: "act", label: "", render: (t) => t.status === "initiated" && can("verify") && (
            <div className="flex gap-1"><Button size="sm" data-testid={`verify-${t.transfer_no}`} onClick={() => verify(t)}><Check className="h-4 w-4" /></Button>
              <Button size="sm" variant="outline" data-testid={`reject-${t.transfer_no}`} onClick={() => reject(t)}><X className="h-4 w-4" /></Button></div>) },
          { key: "admin", label: "", render: (t) => <AdminActions entity="transfers" row={t} onDone={reload} testid={`transfer-${t.transfer_no}`} /> },
        ]} />
      </div>
      <TransferDialog st={tr} setSt={setTr} done={reload} />
      <QueryDialog st={qy} setSt={setQy} saleId={saleId} done={reload} />
    </Panel>
  );
}
