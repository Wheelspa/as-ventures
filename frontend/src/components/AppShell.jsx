import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api, clearToken } from "@/lib/api";
import { FormDialog, Field, run } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Bell, LayoutDashboard, Users, ShoppingCart, Boxes, Receipt, HandCoins, BookOpen, MessageSquare, FileBarChart, ShieldCheck, History, UserCog, Menu, Wallet, LogOut, KeyRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { fdt } from "@/lib/fmt";
import { useMe } from "@/lib/me";
import { Brand } from "@/pages/AuthPages";

function navItems(me, can) {
  return [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, show: true },
    { to: "/investors", label: "Investors", icon: Users, show: can("staff") },
    { to: `/investors/${me.investor_id}`, label: "My Investment", icon: Wallet, show: !can("staff") && !!me.investor_id },
    { to: "/purchases", label: "Purchases", icon: ShoppingCart, show: true },
    { to: "/inventory", label: "PPF Inventory", icon: Boxes, show: true },
    { to: "/sales", label: "Sales", icon: Receipt, show: true },
    { to: "/settlements", label: "Settlements", icon: HandCoins, show: true },
    { to: "/ledger", label: "Ledger", icon: BookOpen, show: true },
    { to: "/queries", label: "Queries", icon: MessageSquare, show: true },
    { to: "/reports", label: "Reports", icon: FileBarChart, show: can("reports") },
    { to: "/reconciliation", label: "Reconciliation", icon: ShieldCheck, show: true },
    { to: "/audit", label: "Audit Trail", icon: History, show: can("audit") },
    { to: "/users", label: "Users & Logins", icon: UserCog, show: can("users") },
  ].filter((n) => n.show);
}

function Nav({ onPick }) {
  const { me, can } = useMe();
  return (
    <nav className="space-y-0.5">
      {navItems(me, can).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={onPick} data-testid={`nav-${n.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-amber-500/10 text-amber-400" : "text-slate-300 hover:bg-white/[0.04] hover:text-foreground"}`}>
          <n.icon className="h-4 w-4" /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Notifications() {
  const [rows, setRows] = useState([]);
  const nav = useNavigate();
  const load = () => api.get("/notifications").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  const unread = rows.filter((r) => !r.read).length;
  return (
    <Popover onOpenChange={(o) => { if (!o && unread) api.post("/notifications/read-all").then(load); }}>
      <PopoverTrigger asChild>
        <button data-testid="notifications-bell" className="relative rounded-lg p-2 hover:bg-white/[0.05]">
          <Bell className="h-5 w-5" />
          {unread > 0 && <span data-testid="notifications-count" className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-600 px-1 font-mono text-[10px] font-bold text-black">{unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="border-b border-border/60 px-4 py-3 font-display font-bold">Notifications</div>
        <div className="max-h-96 overflow-y-auto" data-testid="notifications-list">
          {rows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No notifications</div>}
          {rows.map((n) => (
            <button key={n.id} onClick={() => n.link && nav(n.link)} className={`block w-full border-b border-border/30 px-4 py-3 text-left hover:bg-white/[0.03] ${n.read ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />} {n.title}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{n.message}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">{fdt(n.created_at)}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu() {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const out = () => { clearToken(); window.location.href = "/"; };
  return (
    <div className="flex items-center gap-1">
      <span className="hidden text-right text-xs leading-tight sm:block"><span className="block font-semibold" data-testid="current-user-name">{me.name}</span><span className="text-muted-foreground">{me.role_label}</span></span>
      <button title="Change password" data-testid="change-password-btn" onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-white/[0.05]"><KeyRound className="h-4 w-4" /></button>
      <button title="Sign out" data-testid="logout-btn" onClick={out} className="rounded-lg p-2 hover:bg-white/[0.05]"><LogOut className="h-4 w-4" /></button>
      <FormDialog open={open} onOpenChange={setOpen} title="Change password" testid="change-password-dialog"
        onSubmit={() => run(() => api.post("/auth/change-password", f), "Password changed")}>
        <Field label="Current password"><Input data-testid="current-password-input" type="password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
        <Field label="New password (min 8 characters)"><Input data-testid="new-password-input" type="password" required minLength={8} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
      </FormDialog>
    </div>
  );
}

export default function AppShell({ children }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  return (
    <div className="grain min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border/60 bg-[#0D1119] p-4 lg:flex">
        <Brand />
        <div className="mt-8 flex-1 overflow-y-auto"><Nav /></div>
        <div className="rounded-lg border border-border/60 p-3 text-xs">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Signed in as</div>
          <div className="mt-1 truncate font-semibold" data-testid="current-user-role">{me.role_label}</div>
          {me.investor && <div className="truncate text-muted-foreground">{me.investor.name} · {me.investor.code}</div>}
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button className="rounded-lg p-2 hover:bg-white/[0.05] lg:hidden" data-testid="mobile-nav-toggle"><Menu className="h-5 w-5" /></button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-[#0D1119] p-4">
                <Brand small />
                <div className="mt-6"><Nav onPick={() => setOpen(false)} /></div>
              </SheetContent>
            </Sheet>
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">S & A Ventures · ₹ · IST</span>
          </div>
          <div className="flex items-center gap-2">
            <Notifications />
            <UserMenu />
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
