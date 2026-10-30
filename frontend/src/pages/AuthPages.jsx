import { SignIn, SignUp, SignOutButton } from "@clerk/react";
import { ShieldCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

const HERO = "https://images.unsplash.com/photo-1780568239721-9922fabf2fed?crop=entropy&cs=srgb&fm=jpg&q=80&w=1400";

export const Brand = ({ small }) => (
  <div className="flex items-center gap-2.5" data-testid="brand-logo">
    <div className={`grid place-items-center rounded-lg bg-amber-600 font-display font-extrabold text-[#0B0E14] ${small ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm"}`}>S&A</div>
    <div className="leading-tight">
      <div className="font-display text-base font-extrabold tracking-tight">S & A Ventures</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">PPF · Investor Ledger</div>
    </div>
  </div>
);

function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden flex-1 overflow-hidden lg:flex">
        <img src={HERO} alt="Gloss automotive paint protection film" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0E14] via-[#0B0E14]/70 to-transparent" />
        <div className="relative z-10 mt-auto max-w-xl p-12">
          <Brand />
          <h1 className="mt-8 text-4xl font-extrabold tracking-tight lg:text-5xl">Every rupee. Every roll. Every settlement.</h1>
          <p className="mt-4 text-base text-slate-300">Order-to-order principal recovery and 50:50 margin sharing, verified with bank proof and visible to both Wheelspa and its investors.</p>
          <div className="mt-6 flex items-center gap-2 font-mono text-xs text-amber-400"><ShieldCheck className="h-4 w-4" /> Immutable ledger · Asia/Kolkata</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="lg:hidden"><Brand /></div>
        {children}
        <p className="max-w-sm text-center text-xs text-muted-foreground">Access is granted by the Wheelspa Super Admin. New sign-ups stay pending until approved.</p>
      </div>
    </div>
  );
}

export const SignInPage = () => (
  <AuthLayout><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" withSignUp /></AuthLayout>
);

export const SignUpPage = () => (
  <AuthLayout><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" /></AuthLayout>
);

export const PendingPage = ({ me }) => (
  <div className="grid min-h-screen place-items-center bg-background p-6">
    <div data-testid="pending-access" className="max-w-md rounded-xl border border-amber-500/30 bg-card p-8 text-center">
      <Clock className="mx-auto h-10 w-10 text-amber-400" />
      <h1 className="mt-4 text-2xl font-extrabold">Access pending approval</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You are signed in as <span className="break-all font-mono text-foreground">{me.email}</span>. A Wheelspa Super Admin must grant your role before you can view financial records.
      </p>
      <SignOutButton><Button variant="outline" className="mt-6" data-testid="pending-signout">Sign out</Button></SignOutButton>
    </div>
  </div>
);
