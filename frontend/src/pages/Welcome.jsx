import { useState } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errMsg, clearToken } from "@/lib/api";
import { Brand } from "@/pages/AuthPages";

export default function WelcomePage({ me, onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setErr("The two passwords do not match");
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/change-password", { new_password: pw });
      onDone();
    } catch (x) {
      setErr(errMsg(x));
      setBusy(false);
    }
  };
  return (
    <div className="grain grid min-h-screen place-items-center bg-background p-6">
      <form onSubmit={submit} data-testid="welcome-form" className="fade-up w-full max-w-sm space-y-5 rounded-2xl border border-border/60 bg-card p-8">
        <Brand />
        <div>
          <h1 className="text-2xl font-extrabold" data-testid="welcome-heading">Welcome, {me.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {me.investor?.name ? `Your investor account: ${me.investor.name}. ` : ""}Before you continue, please set your own password. Only you will know it.
          </p>
        </div>
        <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">New password (at least 8 characters)</span>
          <Input data-testid="welcome-new-password-input" type="password" required minLength={8} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">Type it again</span>
          <Input data-testid="welcome-confirm-password-input" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        {err && <div data-testid="welcome-error" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</div>}
        <Button type="submit" className="w-full" disabled={busy} data-testid="welcome-submit-button">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />} Save password and continue
        </Button>
        <button type="button" data-testid="welcome-signout-button" onClick={() => { clearToken(); window.location.href = "/"; }}
          className="flex w-full items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground">
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </form>
    </div>
  );
}
