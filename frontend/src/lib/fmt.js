const nf = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TZ = "Asia/Kolkata";

export const inr = (p) => `${(p || 0) < 0 ? "-" : ""}₹${nf.format(Math.abs(p || 0) / 100)}`;
export const inrShort = (p) => {
  const r = (p || 0) / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${nf.format(r)}`;
};

const toDate = (d) => new Date(d.length === 10 ? `${d}T00:00:00+05:30` : d);
export const fdate = (d) =>
  d ? toDate(d).toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fdt = (d) =>
  d
    ? `${toDate(d).toLocaleString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })} IST`
    : "—";
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export const monthIST = () => todayIST().slice(0, 7);

export const STATUS = {
  settled: ["Settled", "green"],
  awaiting_invoice: ["Awaiting invoice", "amber"],
  awaiting_collection: ["Awaiting customer payment", "amber"],
  overdue: ["Overdue", "red"],
  verification_pending: ["Proof awaiting verification", "amber"],
  transfer_pending: ["Transfer pending", "amber"],
  partially_settled: ["Partially settled", "amber"],
  cancelled: ["Cancelled", "neutral"],
  in_stock: ["In stock", "green"],
  reserved: ["Reserved", "amber"],
  sold: ["Sold", "green"],
  damaged: ["Damaged", "red"],
  returned: ["Returned", "red"],
  disputed: ["Disputed", "red"],
  invoiced: ["Invoiced · unpaid", "amber"],
  partially_paid: ["Partially paid", "amber"],
  paid: ["Paid in full", "green"],
  initiated: ["Unverified proof", "amber"],
  verified: ["Verified", "green"],
  rejected: ["Rejected", "red"],
  unpaid: ["Unpaid", "red"],
  partial: ["Partially paid", "amber"],
  pending: ["Pending approval", "amber"],
  approved: ["Approved", "green"],
  open: ["Open", "amber"],
  answered: ["Answered", "green"],
  closed: ["Closed", "neutral"],
  voided: ["Voided", "neutral"],
};
