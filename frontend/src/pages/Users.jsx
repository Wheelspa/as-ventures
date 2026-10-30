import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, Field, NSelect, PageHeader, Panel, run, useForm, useLoad } from "@/components/common";
import { api } from "@/lib/api";
import { fdt } from "@/lib/fmt";
import { useMe } from "@/lib/me";

function RoleCell({ u, roles, investors, done }) {
  const save = (role, investor_id) => run(() => api.patch(`/users/${u.user_id}/role`, { role, investor_id: investor_id || null }), "Role updated").then(done);
  return (
    <div className="flex flex-wrap gap-2">
      <div className="w-44"><NSelect testid={`user-role-${u.email}`} value={u.role} onChange={(r) => (r === "investor" ? save(r, investors?.[0]?.id) : save(r))} options={roles.map((r) => ({ value: r.id, label: r.label }))} /></div>
      {u.role === "investor" && <div className="w-44"><NSelect testid={`user-investor-${u.email}`} value={u.investor_id} onChange={(v) => save("investor", v)} options={(investors || []).map((i) => ({ value: i.id, label: i.name }))} /></div>}
    </div>
  );
}

export default function UsersPage() {
  const { me } = useMe();
  const [d, reload] = useLoad("/users");
  const [investors] = useLoad("/investors");
  const [f, set, setF] = useForm({ name: "", email: "", password: "", role: "investor", investor_id: "" });
  const roles = (d?.roles || []).filter((r) => r.id !== "pending");
  const add = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post("/users", { ...f, investor_id: f.investor_id || null }), `Login created — share the email and password with ${f.name || f.email}`);
    if (r) { setF({ name: "", email: "", password: "", role: "investor", investor_id: "" }); reload(); }
  };
  const reset = (u) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 characters)`);
    if (pw) run(() => api.post(`/users/${u.user_id}/password`, { password: pw }), "Password reset");
  };
  const del = (u) => run(() => api.delete(`/users/${u.user_id}`), "Login deleted").then(reload);
  return (
    <div>
      <PageHeader title="Users & Logins" subtitle="Create an email and password for each investor and staff member. There is no public sign-up." />
      <Panel title="Create a login" className="mb-6">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <Field label="Name"><Input data-testid="new-user-name" required value={f.name} onChange={set("name")} /></Field>
          <Field label="Email"><Input data-testid="new-user-email" type="email" required value={f.email} onChange={set("email")} /></Field>
          <Field label="Password (min 8)"><Input data-testid="new-user-password" type="password" required minLength={8} value={f.password} onChange={set("password")} /></Field>
          <Field label="Role"><NSelect testid="new-user-role" value={f.role} onChange={set("role")} options={roles.map((r) => ({ value: r.id, label: r.label }))} /></Field>
          {f.role === "investor" ? <Field label="Investor account"><NSelect testid="new-user-investor" value={f.investor_id} onChange={set("investor_id")} placeholder="Select" options={(investors || []).map((i) => ({ value: i.id, label: `${i.name} · ${i.code}` }))} /></Field> : <div />}
          <Button type="submit" data-testid="new-user-submit">Create login</Button>
        </form>
      </Panel>
      <Panel title="Logins">
        <DataTable testid="users-table" rowKey="user_id" rows={d?.users?.filter((u) => u.role !== "pending")} columns={[
          { key: "name", label: "Name", render: (u) => <div>{u.name}<div className="text-xs text-muted-foreground">{u.email}</div>
            {u.reset_requested_at && <span data-testid={`reset-requested-${u.email}`} className="mt-1 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">Asked for a password reset · {fdt(u.reset_requested_at)}</span>}</div> },
          { key: "role", label: "Role & investor link", render: (u) => <RoleCell u={u} roles={roles} investors={investors} done={reload} /> },
          { key: "created_at", label: "Created", render: (u) => fdt(u.created_at) },
          { key: "act", label: "", render: (u) => <div className="flex gap-1">
            <Button size="icon" variant="ghost" title="Reset password" data-testid={`reset-password-${u.email}`} onClick={() => reset(u)}><KeyRound className="h-4 w-4" /></Button>
            {u.user_id !== me.user_id && <Button size="icon" variant="ghost" className="text-red-400" title="Delete login" data-testid={`delete-user-${u.email}`} onClick={() => del(u)}><Trash2 className="h-4 w-4" /></Button>}
          </div> },
        ]} />
      </Panel>
      {me.role === "admin" && <EraseAll />}
    </div>
  );
}

function EraseAll() {
  const [txt, setTxt] = useState("");
  const [open, setOpen] = useState(false);
  const go = () => run(() => api.post("/admin/erase-all", { confirm: txt }), "All business data erased").then((r) => { if (r) window.location.href = "/"; });
  return (
    <Panel title="Danger zone" className="mt-6 border-red-500/40" testid="danger-zone">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">Erase all investors, purchases, stock, sales, payments, settlements, ledger, documents, queries, notifications and audit history. Logins are kept, so everyone can still sign in. This cannot be undone.</p>
        {!open ? <Button variant="outline" className="border-red-500/50 text-red-400" data-testid="erase-all-open" onClick={() => setOpen(true)}><Trash2 className="mr-1 h-4 w-4" />Erase all data</Button> : (
          <div className="flex flex-wrap items-center gap-2">
            <Input data-testid="erase-all-confirm-input" className="w-44" placeholder="Type DELETE" value={txt} onChange={(e) => setTxt(e.target.value)} />
            <Button className="bg-red-600 text-white hover:bg-red-700" disabled={txt !== "DELETE"} data-testid="erase-all-submit" onClick={go}>Erase everything</Button>
            <Button variant="ghost" data-testid="erase-all-cancel" onClick={() => { setOpen(false); setTxt(""); }}>Cancel</Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
