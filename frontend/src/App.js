import { useEffect, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { api, errMsg, getToken, clearToken } from "@/lib/api";
import { MeContext } from "@/lib/me";
import AppShell from "@/components/AppShell";
import LoginPage from "@/pages/Login";
import WelcomePage from "@/pages/Welcome";
import UsersPage from "@/pages/Users";
import Dashboard from "@/pages/Dashboard";
import Investors from "@/pages/Investors";
import InvestorDetail from "@/pages/InvestorDetail";
import Purchases from "@/pages/Purchases";
import Inventory from "@/pages/Inventory";
import RollTrace from "@/pages/RollTrace";
import Sales from "@/pages/Sales";
import SaleDetail from "@/pages/SaleDetail";
import Settlements from "@/pages/Settlements";
import Ledger from "@/pages/Ledger";
import Queries from "@/pages/Queries";
import Reports from "@/pages/Reports";
import Reconciliation from "@/pages/Reconciliation";
import Audit from "@/pages/Audit";

function Gate() {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.get("/me").then((r) => setMe(r.data)).catch((e) => setErr(errMsg(e)));
  }, []);
  if (err) return <div className="p-8 text-red-400" data-testid="me-error">{err} <button className="ml-3 underline" onClick={() => { clearToken(); window.location.href = "/"; }}>Sign out</button></div>;
  if (!me) return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-amber-500" /></div>;
  if (me.must_change_password) return <WelcomePage me={me} onDone={() => setMe({ ...me, must_change_password: false })} />;
  return (
    <MeContext.Provider value={me}>
      <AppShell>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/investors" element={<Investors />} />
          <Route path="/investors/:id" element={<InvestorDetail />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/rolls/:id" element={<RollTrace />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/sales/:id" element={<SaleDetail />} />
          <Route path="/settlements" element={<Settlements />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/queries" element={<Queries />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </MeContext.Provider>
  );
}

function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <Routes>
          <Route path="/*" element={getToken() ? <Gate /> : <LoginPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme="dark" richColors position="top-right" />
    </div>
  );
}

export default App;
