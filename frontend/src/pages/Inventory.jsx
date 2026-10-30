import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { DataTable, PageHeader, Panel, useLoad } from "@/components/common";
import { fdate, inr, todayIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

const FILTERS = [["all", "All"], ["stock", "In stock"], ["soldout", "Sold out"]];
const age = (d) => Math.round((new Date(todayIST()) - new Date(d)) / 86400000);
const Num = ({ v, tone, testid }) => <span data-testid={testid} className={`font-mono font-semibold ${v ? tone : "text-muted-foreground"}`}>{v}</span>;

const Summary = ({ rows }) => {
  const sum = (k) => (rows || []).reduce((a, r) => a + r[k], 0);
  const items = [["Batches", (rows || []).length], ["Rolls bought", sum("total")], ["In stock", sum("in_stock")], ["Sold", sum("sold")], ["Stock value (base)", inr(sum("stock_value"))]];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="inventory-summary">
      {items.map(([l, v]) => (
        <div key={l} className="rounded-xl border border-border/60 bg-card p-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{l}</div>
          <div className="mt-1 text-xl font-bold" data-testid={`inventory-summary-${l.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{v}</div>
        </div>
      ))}
    </div>
  );
};

export default function Inventory() {
  const { staff } = useMe();
  const [sp] = useSearchParams();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [all] = useLoad("/inventory/batches", { q: q || undefined, investor_id: sp.get("investor") || undefined });
  const pid = sp.get("purchase");
  const rows = (all || []).filter((r) => (!pid || r.purchase_id === pid) && (filter === "all" || (filter === "stock" ? r.in_stock > 0 : r.in_stock === 0)));
  return (
    <div>
      <PageHeader title="PPF Inventory" subtitle="One line per purchase batch: how many rolls were bought, how many are in stock and how many are sold." />
      <Summary rows={all} />
      <Panel actions={<Input data-testid="inventory-search" placeholder="Search batch, brand, PO…" className="w-64" value={q} onChange={(e) => setQ(e.target.value)} />}
        title={<div className="flex flex-wrap gap-1">{FILTERS.map(([v, l]) => (
          <button key={v} data-testid={`inventory-filter-${v}`} onClick={() => setFilter(v)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === v ? "bg-amber-600 text-black" : "border border-border/60 text-muted-foreground hover:text-foreground"}`}>{l}</button>))}</div>}>
        <DataTable testid="inventory-table" rows={rows} empty="No batches yet. Log a purchase invoice to add stock." columns={[
          { key: "po_number", label: "PO · Batch", render: (r) => <div><Link data-testid={`batch-link-${r.po_number}`} className="font-mono text-amber-400 hover:underline" to="/purchases">{r.po_number}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.batch_no}</div></div> },
          { key: "prod", label: "Product", render: (r) => <div>{r.brand} {r.series}<div className="text-[11px] text-muted-foreground">{[r.thickness, r.specs].filter(Boolean).join(" · ")}</div></div> },
          { key: "purchase_date", label: "Purchased", render: (r) => <div>{fdate(r.purchase_date)}<div className="text-[11px] text-muted-foreground">{age(r.purchase_date) === 1 ? "1 day" : `${age(r.purchase_date)} days`} ago</div></div> },
          { key: "total", label: "Bought", right: true, render: (r) => <Num v={r.total} tone="" testid={`batch-total-${r.po_number}`} /> },
          { key: "in_stock", label: "In stock", right: true, render: (r) => <Num v={r.in_stock} tone="text-emerald-400" testid={`batch-instock-${r.po_number}`} /> },
          { key: "sold", label: "Sold", right: true, render: (r) => <Num v={r.sold + r.reserved} tone="text-amber-400" testid={`batch-sold-${r.po_number}`} /> },
          { key: "other", label: "Damaged / returned", right: true, render: (r) => <Num v={r.other} tone="text-red-400" testid={`batch-other-${r.po_number}`} /> },
          ...(staff ? [{ key: "landed_cost", label: "Landed cost / roll", right: true, money: true }] : []),
          { key: "base_price", label: "Principal / roll", right: true, money: true },
          { key: "stock_value", label: "Stock value", right: true, money: true },
          { key: "funding", label: "Funded by", render: (r) => r.funding.map((x) => `${x.investor_name} ${x.pct_bp / 100}%`).join(", ") },
        ]} />
      </Panel>
    </div>
  );
}
