import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Plus, Receipt, HandCoins, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, Kpi, PageHeader, Panel, StatusBadge, useLoad } from "@/components/common";
import { fdate, inr, inrShort } from "@/lib/fmt";
import { useMe } from "@/lib/me";

const PIE = { in_stock: "#10B981", reserved: "#F59E0B", sold: "#64748B", damaged: "#EF4444", returned: "#F87171", disputed: "#DC2626" };
const tip = { contentStyle: { background: "#121722", border: "1px solid #253047", borderRadius: 8, fontSize: 12 }, formatter: (v) => inr(v) };

function Charts({ d }) {
  const pie = Object.entries(d.inventory.counts).map(([k, v]) => ({ name: k.replace("_", " "), key: k, value: v }));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel title="Sales split by month" className="lg:col-span-2" testid="chart-monthly">
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={d.monthly}>
              <CartesianGrid stroke="#1E2738" vertical={false} />
              <XAxis dataKey="month" stroke="#64748B" fontSize={11} />
              <YAxis stroke="#64748B" fontSize={11} tickFormatter={inrShort} width={70} />
              <Tooltip {...tip} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="base" stackId="a" name="Base (principal)" fill="#334155" />
              <Bar dataKey="investor_margin" stackId="a" name="Investor 15%" fill="#D97706" />
              <Bar dataKey="wheelspa_margin" stackId="a" name="Wheelspa 15%" fill="#10B981" />
              <Bar dataKey="gst" stackId="a" name="GST 18%" fill="#64748B" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="Inventory status" testid="chart-inventory">
        <div className="h-64">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {pie.map((p) => <Cell key={p.key} fill={PIE[p.key] || "#94A3B8"} />)}
              </Pie>
              <Tooltip contentStyle={tip.contentStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}

function InventorySummary({ inv, aging }) {
  const items = [["Rolls purchased", inv.purchased], ["In stock", inv.in_stock], ["Reserved", inv.reserved], ["Sold", inv.sold], ["Damaged / returned / disputed", inv.exceptions]];
  return (
    <Panel title="Inventory summary" testid="inventory-summary">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([l, v]) => (
          <div key={l}><div className="font-mono text-2xl font-bold">{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
        ))}
        <div><div className="font-mono text-lg font-bold">{inr(inv.purchase_cost)}</div><div className="text-xs text-muted-foreground">Inventory purchase cost</div></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground">Unsold stock aging:</span>
        {aging.map((a) => <span key={a.bucket} className="rounded-full border border-border/60 px-2.5 py-0.5 font-mono text-[11px]">{a.bucket} days · {a.rolls}</span>)}
      </div>
    </Panel>
  );
}

function CapitalPanel({ d }) {
  const c = d.capital;
  return (
    <Panel title="Capital added & returned" testid="capital-panel">
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[["Capital added", c.added, "text-emerald-400", "capital-added"], ["Capital returned", c.returned, "text-amber-400", "capital-returned"], ["Outstanding", c.outstanding, "", "capital-outstanding"]].map(([l, v, cl, t]) => (
          <div key={l}><div className={`font-mono text-base font-bold sm:text-lg ${cl}`} data-testid={t}>{inr(v)}</div><div className="text-xs text-muted-foreground">{l}</div></div>
        ))}
      </div>
      <DataTable testid="capital-moves" rowKey="txn_id" rows={d.capital_moves} empty="No capital added or returned yet" columns={[
        { key: "date", label: "Date", render: (r) => fdate(r.date) },
        { key: "investor_name", label: "Investor" },
        { key: "type", label: "Movement", render: (r) => (r.type === "CAPITAL_RECEIVED" ? <span className="text-emerald-400">{r.amount < 0 ? "Capital correction" : "Capital added"}</span> : <span className="text-amber-400">Capital returned</span>) },
        { key: "amount", label: "Amount", right: true, money: true },
      ]} />
    </Panel>
  );
}

const Line = ({ l, v, c = "", testid }) => (
  <div className={`flex justify-between gap-3 border-b border-border/30 py-1.5 text-sm ${c}`}><span>{l}</span><span className="font-mono" data-testid={testid}>{inr(v)}</span></div>
);

function ProfitPanel({ d }) {
  const e = d.example;
  const p = d.profit;
  return (
    <Panel title="Profit share calculation" testid="profit-panel">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">Per roll (current approved terms)</div>
          {e ? <>
            <Line l="Average price per roll (excl. GST)" v={e.base} testid="profit-ex-base" />
            <Line l={`Margin @ ${e.margin_bp / 100}%`} v={e.margin} testid="profit-ex-margin" />
            <Line l={`Less income tax @ ${e.tax_bp / 100}%`} v={e.income_tax} c="text-red-400" testid="profit-ex-tax" />
            <Line l="Net margin to distribute" v={e.net_margin} testid="profit-ex-net" />
            <Line l={`Investor share (${e.investor_share_bp / 100}%)`} v={e.investor_margin} c="text-amber-400" testid="profit-ex-investor" />
            <Line l={`Wheelspa share (${100 - e.investor_share_bp / 100}%)`} v={e.wheelspa_margin} c="text-emerald-400" testid="profit-ex-wheelspa" />
            <Line l={`GST @ ${e.gst_bp / 100}% (separate, not profit)`} v={e.gst} c="text-slate-400" />
            <Line l="Customer invoice per roll" v={e.total} c="font-bold" testid="profit-ex-total" />
          </> : <div className="text-sm text-muted-foreground" data-testid="profit-ex-empty">Approve commercial terms to see the per-roll calculation.</div>}
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-400">All invoiced sales · {p.rolls} rolls</div>
          <Line l="Total margin" v={p.margin} testid="profit-total-margin" />
          <Line l="Income tax deducted" v={p.income_tax} c="text-red-400" testid="profit-total-tax" />
          <Line l="Net margin distributed" v={p.net_margin} testid="profit-total-net" />
          <Line l="Investor share" v={p.investor_margin} c="text-amber-400" testid="profit-total-investor" />
          <Line l="Wheelspa share" v={p.wheelspa_margin} c="text-emerald-400" testid="profit-total-wheelspa" />
          <Line l="GST (separate)" v={p.gst} c="text-slate-400" />
        </div>
      </div>
    </Panel>
  );
}

const LowStock = ({ items }) => !items?.length ? null : (
  <div className="fade-up rounded-xl border border-amber-500/40 bg-amber-500/10 p-4" data-testid="low-stock-alert">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-400"><AlertTriangle className="h-4 w-4" />Low stock: time to reorder</div>
    <ul className="space-y-1 text-sm">
      {items.map((b) => (
        <li key={b.purchase_id} data-testid={`low-stock-${b.po_number}`} className="flex flex-wrap items-center justify-between gap-2">
          <span><span className="font-mono text-amber-400">{b.po_number}</span> · {b.product} <span className="font-mono text-xs text-muted-foreground">{b.batch_no}</span></span>
          <span className="font-mono text-xs">only <b className="text-amber-300">{b.in_stock}</b> of {b.total} rolls left</span>
        </li>
      ))}
    </ul>
    <Link to="/purchases?new=1" className="mt-3 inline-block text-xs font-semibold text-amber-400 hover:underline" data-testid="low-stock-reorder">Log a new purchase →</Link>
  </div>
);

export default function Dashboard() {
  const { me, can, staff } = useMe();
  const [d] = useLoad("/dashboard");
  return (
    <div>
      <PageHeader
        title={staff ? "Command Centre" : `Welcome, ${me.investor?.name || me.name}`}
        subtitle={staff ? "Live view of investor capital, PPF inventory, collections and order-to-order settlements." : "Your capital, the rolls it funds, and every principal and margin transfer — verified."}
        actions={can("record") && <>
          <Button asChild data-testid="quick-new-purchase"><Link to="/purchases?new=1"><Plus className="mr-1 h-4 w-4" />Log roll batch</Link></Button>
          <Button asChild variant="outline" data-testid="quick-new-sale"><Link to="/sales?new=1"><Receipt className="mr-1 h-4 w-4" />New sale</Link></Button>
          <Button asChild variant="outline" data-testid="quick-settlements"><Link to="/settlements"><HandCoins className="mr-1 h-4 w-4" />Process payout</Link></Button>
        </>}
      />
      {!d ? <div className="text-muted-foreground">Loading…</div> : (
        <div className="space-y-6">
          <LowStock items={d.low_stock} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="kpi-grid">
            {d.kpis.map((k, i) => <Kpi key={k.key} item={k} i={i} />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <CapitalPanel d={d} />
            <ProfitPanel d={d} />
          </div>
          <InventorySummary inv={d.inventory} aging={d.aging} />
          <Charts d={d} />
          <div className="grid gap-4 xl:grid-cols-5">
            <Panel title="Recent settlements" className="xl:col-span-3" actions={<Link to="/settlements" className="text-xs text-amber-400">View all</Link>}>
              <DataTable testid="recent-settlements" rows={d.recent} columns={[
                { key: "order_no", label: "Order", render: (r) => <Link className="font-mono text-amber-400 hover:underline" to={`/sales/${r.sale_id}`}>{r.order_no}</Link> },
                { key: "roll_serial", label: "Rolls", render: (r) => <span className="font-mono text-xs">{r.roll_serial}</span> },
                { key: "principal_paid", label: "Principal repaid", right: true, money: true },
                { key: "margin_paid", label: "Margin paid", right: true, money: true },
                { key: "due_date", label: "Due", render: (r) => fdate(r.due_date) },
                { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              ]} />
            </Panel>
            <Panel title="Profitability by product" className="xl:col-span-2">
              <DataTable testid="product-profitability" rowKey="product" rows={d.products} columns={[
                { key: "product", label: "Product" },
                { key: "rolls", label: "Rolls", right: true },
                { key: "investor_margin", label: "Investor", right: true, money: true },
                { key: "wheelspa_margin", label: "Wheelspa", right: true, money: true },
              ]} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
