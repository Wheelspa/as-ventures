import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DataTable, DocButton, Field, FormDialog, PageHeader, Panel, StatusBadge, UploadField, run, useForm, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { fdt } from "@/lib/fmt";

function Thread({ q, setQ, done }) {
  const [f, set, setF] = useForm({ message: "", doc_id: null });
  return (
    <FormDialog open={!!q} onOpenChange={() => setQ(null)} title={`${q?.query_no} · ${q?.subject}`} testid="query-thread-dialog" submitLabel="Send reply"
      description={q?.order_no ? `Linked to order ${q.order_no}` : ""}
      onSubmit={() => run(() => api.post(`/queries/${q.id}/reply`, f), "Reply sent").then((r) => { if (r) { setF({ message: "", doc_id: null }); done(); } return r; })}>
      <div className="max-h-72 space-y-3 overflow-y-auto" data-testid="query-messages">
        {q?.messages.map((m, i) => (
          <div key={i} className={`rounded-lg border p-3 text-sm ${m.role === "investor" ? "border-amber-500/30 bg-amber-500/5" : "border-border/60"}`}>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground"><b className="text-foreground">{m.by}</b><span>{fdt(m.at)}</span></div>
            {m.text}{m.doc_id && <div className="mt-1"><DocButton id={m.doc_id} label="Attachment" /></div>}
          </div>
        ))}
      </div>
      {q?.status !== "closed" && <>
        <Field label="Reply"><textarea data-testid="query-reply-input" required className="nselect h-20 py-2" value={f.message} onChange={set("message")} /></Field>
        <Field label="Supporting document"><UploadField testid="query-reply-upload" value={f.doc_id} onChange={set("doc_id")} /></Field>
      </>}
    </FormDialog>
  );
}

export default function Queries() {
  const [rows, reload] = useLoad("/queries");
  const [open, setOpen] = useState(null);
  const close = (q) => run(() => api.post(`/queries/${q.id}/close`), "Query closed").then(reload);
  return (
    <div>
      <PageHeader title="Transaction Queries" subtitle="Investors raise queries against specific orders; Wheelspa responds with remarks and documents. Financial entries are never altered here." />
      <Panel>
        <DataTable testid="queries-table" rows={rows} empty="No queries raised. Investors can raise one from any settlement on a sales order." columns={[
          { key: "query_no", label: "Query", render: (r) => <span className="font-mono text-xs">{r.query_no}</span> },
          { key: "subject", label: "Subject", render: (r) => <button data-testid={`open-query-${r.query_no}`} className="text-left text-amber-400 hover:underline" onClick={() => setOpen(r)}>{r.subject}</button> },
          { key: "order_no", label: "Order", render: (r) => r.sale_id ? <Link className="font-mono text-xs hover:underline" to={`/sales/${r.sale_id}`}>{r.order_no}</Link> : "—" },
          { key: "created_by", label: "Raised by" }, { key: "created_at", label: "Raised", render: (r) => fdt(r.created_at) },
          { key: "n", label: "Messages", right: true, render: (r) => r.messages.length },
          { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} testid={`query-status-${r.query_no}`} /> },
          { key: "act", label: "", render: (r) => r.status !== "closed" && <Button size="sm" variant="ghost" data-testid={`close-query-${r.query_no}`} onClick={() => close(r)}>Close</Button> },
        ]} />
      </Panel>
      <Thread q={open} setQ={setOpen} done={() => { reload(); setOpen(null); }} />
    </div>
  );
}
