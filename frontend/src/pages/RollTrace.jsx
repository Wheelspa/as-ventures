import { Link, useParams } from "react-router-dom";
import { Package, Wallet, Receipt, HandCoins, BookOpen } from "lucide-react";
import { DataTable, DocButton, PageHeader, Panel, StatusBadge, useLoad } from "@/components/common";
import { fdate, fdt, inr } from "@/lib/fmt";

const Step = ({ icon: Icon, title, children, done }) => (
  <div className="relative border-l border-border/60 pb-8 pl-8 last:pb-0">
    <div className={`absolute -left-4 top-0 grid h-8 w-8 place-items-center rounded-full border ${done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}`}><Icon className="h-4 w-4" /></div>
    <h3 className="text-base font-bold">{title}</h3>
    <div className="mt-2 text-sm">{children}</div>
  </div>
);

export default function RollTrace() {
  const { id } = useParams();
  const [d] = useLoad(`/rolls/${id}/trace`);
  if (!d) return <div className="text-muted-foreground">Loading…</div>;
  const { roll, purchase } = d;
  const sale = d.sales.find((s) => s.active) || d.sales[0];
  return (
    <div>
      <PageHeader title={<span className="font-mono">{roll.roll_id}</span>} subtitle={`${roll.brand} ${roll.series} · ${roll.thickness} · ${roll.specs}`} actions={<StatusBadge status={roll.status} testid="trace-roll-status" />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Panel title="Capital trail: purchase → sale → repayment" className="lg:col-span-3" testid="roll-trace">
          <div className="ml-4">
            <Step icon={Package} title="Purchased" done>
              {purchase && <>{purchase.po_number} · {fdate(purchase.purchase_date)} · {purchase.supplier} (inv {purchase.supplier_invoice})<div className="mt-1 flex gap-3"><DocButton id={purchase.invoice_doc_id} label="Supplier invoice" /></div></>}
            </Step>
            <Step icon={Wallet} title={`Funded · principal ${inr(roll.base_price)}`} done>
              {roll.funding.map((f) => <div key={f.investor_id}>{f.investor_name}: {f.pct_bp / 100}% · <span className="font-mono">{inr(f.principal)}</span></div>)}
            </Step>
            <Step icon={Receipt} title={sale ? `Sales order ${sale.order_no}` : "Not yet sold"} done={!!sale && sale.status === "paid"}>
              {sale && <div className="space-y-1"><Link className="text-amber-400 hover:underline" to={`/sales/${sale.id}`}>{sale.customer_name}</Link> · invoice {inr(sale.pricing.total)} · collected {inr(sale.collected)} <StatusBadge status={sale.status} /></div>}
            </Step>
            <Step icon={HandCoins} title="Settlement to investor" done={d.settlements.length > 0 && d.settlements.every((s) => s.status === "settled")}>
              {d.settlements.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-2">{s.investor_name}: principal {inr(s.principal_paid)}/{inr(s.principal_due)} · margin {inr(s.margin_paid)}/{inr(s.margin_due)} <StatusBadge status={s.status} /></div>)}
              {d.transfers.map((t) => <div key={t.id} className="mt-1 font-mono text-xs text-muted-foreground">{t.transfer_no} {t.kind} {inr(t.amount)} · UTR {t.bank_ref} · {t.status} <DocButton id={t.doc_id} /></div>)}
            </Step>
          </div>
        </Panel>
        <Panel title="Status history" className="lg:col-span-2">
          {(roll.status_history || []).map((h, i) => (
            <div key={i} className="mb-3 flex items-start justify-between gap-3 text-sm"><div><StatusBadge status={h.status} /><div className="mt-1 text-xs text-muted-foreground">{h.reason || ""} · {h.by}</div></div><span className="font-mono text-[11px] text-muted-foreground">{fdt(h.at)}</span></div>
          ))}
        </Panel>
      </div>
      <Panel title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4" />Linked ledger entries</span>} className="mt-6">
        <DataTable testid="trace-ledger" rowKey="txn_id" rows={d.ledger} columns={[
          { key: "txn_id", label: "Txn", render: (r) => <span className="font-mono text-xs">{r.txn_id}</span> }, { key: "date", label: "Date", render: (r) => fdate(r.date) },
          { key: "type", label: "Type" }, { key: "amount", label: "Amount", right: true, money: true }, { key: "remarks", label: "Remarks" },
        ]} />
      </Panel>
    </div>
  );
}
