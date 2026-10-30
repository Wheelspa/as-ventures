import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, Loader2, Paperclip, Upload } from "lucide-react";
import { api, errMsg, openBlob, uploadFile } from "@/lib/api";
import { STATUS, inr } from "@/lib/fmt";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export const TONES = {
  green: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  red: "text-red-400 bg-red-500/10 border-red-500/30",
  neutral: "text-slate-300 bg-slate-500/10 border-slate-500/30",
};

export function useLoad(path, params) {
  const key = JSON.stringify(params || {});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const r = await api.get(path, { params: JSON.parse(key) });
      setData(r.data);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [path, key]);
  useEffect(() => {
    reload();
  }, [reload]);
  return [data, reload, loading];
}

export async function run(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast.success(ok);
    return r ?? true;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

export const StatusBadge = ({ status, testid, label }) => {
  const [text, tone] = STATUS[status] || [status, "neutral"];
  return (
    <span data-testid={testid} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${TONES[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label || text}
    </span>
  );
};

export const Money = ({ v, className = "", testid }) => (
  <span data-testid={testid} className={`font-mono tabular-nums ${className}`}>{inr(v)}</span>
);

export const Kpi = ({ item, i = 0 }) => {
  const toneText = { green: "text-emerald-400", amber: "text-amber-400", red: "text-red-400", neutral: "text-foreground" }[item.tone];
  return (
    <div data-testid={`kpi-${item.key}`} style={{ animationDelay: `${i * 35}ms` }}
      className="fade-up ppf-edge rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-amber-500/40 sm:p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{item.label}</div>
      <div className={`mt-2 font-mono text-xl font-bold tracking-tight sm:text-2xl ${toneText}`}>
        {item.kind === "int" ? item.value : inr(item.value)}
      </div>
      {item.sub && <div className="mt-1 text-xs text-muted-foreground">{item.sub}</div>}
    </div>
  );
};

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <h1 data-testid="page-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Panel = ({ title, actions, children, className = "", testid }) => (
  <section data-testid={testid} className={`min-w-0 rounded-xl border border-border/60 bg-card ${className}`}>
    {(title || actions) && (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3 sm:px-5">
        <h3 className="text-base font-bold">{title}</h3>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    )}
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);

export function DataTable({ columns, rows, testid, empty = "No records yet", rowKey = "id" }) {
  return (
    <div className="overflow-x-auto" data-testid={testid}>
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left">
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground ${c.right ? "text-right" : ""}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((r, i) => (
            <tr key={r[rowKey] || i} className="border-b border-border/30 transition-colors hover:bg-white/[0.02]">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2.5 align-top ${c.right ? "text-right font-mono tabular-nums" : ""}`}>
                  {c.render ? c.render(r) : c.money ? inr(r[c.key]) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows && rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{empty}</div>}
      {!rows && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
    </div>
  );
}

export const Field = ({ label, children, hint, className = "" }) => (
  <label className={`block space-y-1.5 ${className}`}>
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-muted-foreground/80">{hint}</span>}
  </label>
);

export const NSelect = ({ value, onChange, options, testid, placeholder }) => (
  <select data-testid={testid} className="nselect" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

export function UploadField({ value, onChange, testid, label = "Attach document" }) {
  const ref = useRef();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const r = await run(() => uploadFile(f));
    setBusy(false);
    if (r) {
      setName(r.filename);
      onChange(r.id);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" className="hidden" data-testid={`${testid}-input`} onChange={pick} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv" />
      <Button type="button" variant="outline" size="sm" data-testid={testid} onClick={() => ref.current.click()} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} {label}
      </Button>
      <span className="truncate text-xs text-muted-foreground">{value ? name || "Attached" : "No file"}</span>
    </div>
  );
}

export const DocButton = ({ id, label = "Proof", testid }) =>
  id ? (
    <button type="button" data-testid={testid} onClick={() => run(() => openBlob(`/documents/${id}`))}
      className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline">
      <Paperclip className="h-3.5 w-3.5" /> {label}
    </button>
  ) : <span className="text-xs text-muted-foreground">—</span>;

export const ExportButtons = ({ path, params, name, testid = "export" }) => (
  <>
    <Button size="sm" variant="outline" data-testid={`${testid}-pdf`} onClick={() => run(() => openBlob(path, `${name}.pdf`, { ...params, format: "pdf" }))}>
      <FileDown className="mr-1 h-4 w-4" /> PDF
    </Button>
    <Button size="sm" variant="outline" data-testid={`${testid}-xlsx`} onClick={() => run(() => openBlob(path, `${name}.xlsx`, { ...params, format: "xlsx" }))}>
      <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
    </Button>
  </>
);

export function FormDialog({ open, onOpenChange, title, description, children, onSubmit, submitLabel = "Save", testid, wide }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit();
    setBusy(false);
    if (ok) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testid} className={`max-h-[90vh] overflow-y-auto ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {children}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} data-testid={`${testid}-submit`}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const useForm = (init) => {
  const [f, setF] = useState(init);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));
  return [f, set, setF];
};
