import { useState } from "react";
import { ArrowLeft, Loader2, LogIn, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errMsg, setToken } from "@/lib/api";
import { Brand } from "@/pages/AuthPages";

const ForgotForm = ({ email, setEmail, err, busy, sent, onSubmit, back }) => (
  <form onSubmit={onSubmit} data-testid="forgot-form" className="fade-up w-full max-w-sm space-y-5 rounded-2xl border border-border/60 bg-card p-8">
    <Brand />
    <div>
      <h1 className="text-2xl font-extrabold">Forgot password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter your email. Your S & A Ventures admin will be alerted and will share a new password with you.</p>
    </div>
    {sent ? (
      <div data-testid="forgot-sent-message" className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
        Request sent. If this email has a login, the admin has been alerted and will contact you with a new password.
      </div>
    ) : (
      <>
        <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">Email</span>
          <Input data-testid="forgot-email-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {err && <div data-testid="forgot-error" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</div>}
        <Button type="submit" className="w-full" disabled={busy} data-testid="forgot-submit-button">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Alert my admin
        </Button>
      </>
    )}
    <button type="button" data-testid="forgot-back-link" onClick={back} className="flex w-full items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
    </button>
  </form>
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const sendForgot = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/forgot", { email });
      setSent(true);
    } catch (x) {
      setErr(errMsg(x));
    }
    setBusy(false);
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api.post("/auth/login", { email, password });
      setToken(r.data.token);
      window.location.href = "/";
    } catch (x) {
      setErr(errMsg(x));
      setBusy(false);
    }
  };
  return (
    <div className="grain grid min-h-screen place-items-center bg-background p-6">
      {forgot ? <ForgotForm {...{ email, setEmail, err, busy, sent, onSubmit: sendForgot, back: () => { setForgot(false); setSent(false); setErr(""); } }} /> :
      <form onSubmit={submit} data-testid="login-form" className="fade-up w-full max-w-sm space-y-5 rounded-2xl border border-border/60 bg-card p-8">
        <Brand />
        <div>
          <h1 className="text-2xl font-extrabold">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the email and password given by your S & A Ventures admin.</p>
        </div>
        <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">Email</span>
          <Input data-testid="login-email-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">Password</span>
          <Input data-testid="login-password-input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div data-testid="login-error" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</div>}
        <Button type="submit" className="w-full" disabled={busy} data-testid="login-submit-button">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />} Sign in
        </Button>
        <button type="button" data-testid="forgot-password-link" onClick={() => { setForgot(true); setErr(""); }}
          className="w-full text-center text-xs text-muted-foreground transition-colors hover:text-amber-500">Forgot password?</button>
      </form>}
    </div>
  );
}
