import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, ExportButtons, Field, NSelect, PageHeader, Panel, StatusBadge, run, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { fdt, inr, monthIST } from "@/lib/fmt";
import { useMe } from "@/lib/me";

export default function Reports() {
  const { can, staff } = useMe();
  const [list] = useLoad("/reports");
  const [investors] = useLoad("/investors");
  const [stmts, reloadStmts] = useLoad("/statements");
  const [key, setKey] = useState("investment_statement");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [month, setMonth] = useState(monthIST());
  const [inv, setInv] = useState("");
  const isMonthly = key === "monthly_reconciliation";
  const params = isMonthly ? { month, investor_id: inv || undefined } : { date_from: from || undefined, date_to: to || undefined, investor_id: inv || undefined };
  const [rep] = useLoad(`/reports/${key}`, params);
  const publish = () => run(() => api.post("/statements/publish", { investor_id: inv || investors?.[0]?.id, month }), "Monthly statement published to investor").then(reloadStmts);
  return (
    <div>
      <PageHeader title="Reports & Statements" subtitle="All reports support date filters and download as PDF or Excel. Figures come straight from the ledger." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <Panel title="Reports" className="lg:col-span-1">
          <div className="space-y-1" data-testid="report-list">
            {(list || []).map((r, i) => (
              <button key={r.key} data-testid={`report-${r.key}`} onClick={() => setKey(r.key)}
                className={`flex w-full gap-2 rounded-lg px-3 py-2 text-left text-sm ${key === r.key ? "bg-amber-500/10 text-amber-400" : "text-slate-300 hover:bg-white/[0.04]"}`}>
                <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>{r.title}
              </button>
            ))}
          </div>
        </Panel>
        <div className="space-y-6 lg:col-span-3">
          <Panel title={rep?.title || "…"} testid="report-view" actions={<ExportButtons path={`/reports/${key}`} params={params} name={key} testid="report-export" />}>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              {isMonthly ? <Field label="Month"><Input data-testid="report-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field> : <>
                <Field label="From"><Input data-testid="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><Input data-testid="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></>}
              {staff && <Field label="Investor" className="w-56"><NSelect testid="report-investor" value={inv} onChange={setInv} placeholder="All investors" options={(investors || []).map((i) => ({ value: i.id, label: i.name }))} /></Field>}
              {isMonthly && can("publish") && <Button data-testid="publish-statement-btn" onClick={publish}><Send className="mr-1 h-4 w-4" />Publish to investor</Button>}
            </div>
            {rep && Object.keys(rep.summary).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2" data-testid="report-summary">
                {Object.entries(rep.summary).map(([k, v]) => <span key={k} className="rounded-full border border-border/60 px-3 py-1 text-xs"><span className="text-muted-foreground">{k}:</span> <b className="font-mono">{typeof v === "string" && /^-?[\d,]+\.\d\d$/.test(v) ? `₹${v}` : v}</b></span>)}
              </div>
            )}
            <DataTable testid="report-table" rows={rep?.rows} rowKey={rep?.columns?.[0]?.[0]} columns={(rep?.columns || []).map(([k, l, kind]) => ({
              key: k, label: l, right: kind !== "text",
              render: (r) => (kind === "money" ? inr(r[k]) : k === "status" ? <StatusBadge status={r[k]} /> : String(r[k] ?? "—")),
            }))} />
            {rep && <div className="mt-3 font-mono text-[10px] text-muted-foreground">Period {rep.period} · generated {rep.generated_at}</div>}
          </Panel>
          <Panel title="Published monthly statements">
            <DataTable testid="statements-table" rows={stmts} empty="No statements published yet" columns={[
              { key: "month", label: "Month", render: (r) => <span className="font-mono">{r.month}</span> }, { key: "investor_name", label: "Investor" },
              { key: "published_by", label: "Published by" }, { key: "published_at", label: "On", render: (r) => fdt(r.published_at) },
              { key: "dl", label: "", render: (r) => <div className="flex gap-2"><ExportButtons path="/reports/monthly_reconciliation" params={{ month: r.month, investor_id: r.investor_id }} name={`reconciliation_${r.month}`} testid={`stmt-${r.month}`} /></div> },
            ]} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
