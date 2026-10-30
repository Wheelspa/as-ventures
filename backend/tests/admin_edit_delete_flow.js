// Super Admin edit/void/delete regression flow (iteration_2). Run in-browser after Clerk sign-in as admin:
// page.evaluate(open(this_file).read()) -> returns log lines (PASS/FAIL). Creates and cleans up its own TEST_ records.
async () => {
  const L = [];
  const ok = (n, c, extra) => L.push((c ? "PASS " : "FAIL ") + n + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 400) : ""));
  const api = async (method, path, body) => {
    const t = await window.Clerk.session.getToken();
    const r = await fetch("/api" + path, { method, headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { }
    return { s: r.status, j };
  };
  const upload = async () => {
    const t = await window.Clerk.session.getToken();
    const fd = new FormData(); fd.append("file", new Blob(["%PDF-1.4 test"], { type: "application/pdf" }), "TEST_proof.pdf");
    const r = await fetch("/api/documents", { method: "POST", headers: { Authorization: "Bearer " + t }, body: fd });
    return (await r.json()).id;
  };
  const recon = async (tag) => { const r = await api("GET", "/reconciliation"); ok("reconciliation " + tag, r.j && r.j.ok, r.j && r.j.ok ? undefined : (r.j ? r.j.checks.filter((c) => !c.ok) : r)); };
  const edit = (e, id, fields, reason = "TEST_ correction") => api("PATCH", `/admin/${e}/${id}`, { fields, reason });
  const rm = (e, id, mode, reason = "TEST_ removal") => api("POST", `/admin/${e}/${id}/remove`, { mode, reason });
  const inv = async (id) => (await api("GET", "/investors/" + id)).j;
  const D = "2026-10-21";
  try {
    const A0 = (await api("GET", "/investors")).j.find((i) => i.name === "Sample Investor A");
    const b0 = (await inv(A0.id)).balances;
    L.push("A balances start " + JSON.stringify(b0));
    await recon("start");

    // --- validation edges ---
    ok("edit unknown entity 404", (await edit("foo", "x", { a: 1 })).s === 404);
    ok("edit no reason 400", (await edit("investors", A0.id, { phone: "1" }, "")).s === 400);
    ok("edit non-editable field 400", (await edit("investors", A0.id, { invested: 1 })).s === 400);
    ok("edit nothing changed 400", (await edit("investors", A0.id, { name: A0.name })).s === 400);
    ok("remove rolls not allowed 400", (await rm("rolls", "x", "void")).s === 400);
    ok("remove bad mode 400", (await rm("sales", "x", "zap")).s === 400);
    ok("remove investor with investments 409", (await rm("investors", A0.id, "void")).s === 409);
    const seededInv = (await inv(A0.id)).investments[0];
    let r = await edit("investments", seededInv.id, { amount: "1" });
    ok("reduce seeded investment below available -> 400", r.s === 400, r.j);

    // --- purchase create + edits ---
    r = await api("POST", "/purchases", { supplier: "TEST_Supplier", supplier_invoice: "TEST-SI-1", purchase_date: D, brand: "TEST_Brand", qty: 2, unit_cost: 25000, gst_pct: 18, other_charges: 0, base_price: 31250, amount_paid: 0, funding: [{ investor_id: A0.id, pct: 100 }] });
    ok("create TEST purchase", r.s === 200, r.s === 200 ? r.j.po_number : r.j);
    const P = r.j;
    r = await edit("purchases", P.id, { supplier: "TEST_Supplier_Edited", brand: "TEST_Brand2" });
    ok("edit purchase supplier/brand", r.s === 200, r.j);
    let rolls = (await api("GET", "/rolls?purchase_id=" + P.id)).j;
    ok("brand propagated to rolls", rolls.length === 2 && rolls.every((x) => x.brand === "TEST_Brand2"), rolls.map((x) => x.brand));
    r = await edit("purchases", P.id, { unit_cost: "26000", other_charges: "500", amount_paid: "10000" });
    let p2 = (await api("GET", "/purchases")).j.find((x) => x.id === P.id);
    ok("edit purchase money totals", r.s === 200 && p2.subtotal === 5200000 && p2.total === 5200000 + Math.round(5200000 * 0.18) + 50000 && p2.amount_paid === 1000000 && p2.payment_status === "partial", p2 && [p2.subtotal, p2.gst, p2.total, p2.amount_paid, p2.payment_status]);
    r = await edit("purchases", P.id, { gst_pct: "12" });
    p2 = (await api("GET", "/purchases")).j.find((x) => x.id === P.id);
    ok("edit purchase gst_pct", r.s === 200 && p2.gst === 624000, p2 && [p2.gst, p2.total]);
    r = await edit("purchases", P.id, { gst_pct: "" });
    ok("edit purchase gst_pct blank -> 4xx (not 500)", r.s >= 400 && r.s < 500, [r.s, r.j]);
    r = await edit("purchases", P.id, { unit_cost: "abc" });
    ok("edit purchase invalid amount -> 400", r.s === 400, [r.s, r.j]);
    r = await edit("purchases", P.id, { amount_paid: "999999" });
    ok("edit purchase paid > total -> 400", r.s === 400, [r.s, r.j]);
    const bBefore = (await inv(A0.id)).balances;
    r = await edit("purchases", P.id, { base_price: "30000" });
    const bAfter = (await inv(A0.id)).balances;
    ok("edit base price (no rolls sold) adjusts allocated", r.s === 200 && bBefore.allocated - bAfter.allocated === 250000, [r.s, bBefore.allocated, bAfter.allocated]);
    r = await edit("purchases", P.id, { base_price: "31250" });
    ok("revert base price", r.s === 200, r.j);
    await recon("after purchase edits");

    // --- roll id edit ---
    rolls = (await api("GET", "/rolls?purchase_id=" + P.id)).j;
    const R1 = rolls[0], R2 = rolls[1];
    const newSerial = "TEST-ROLL-" + Date.now() % 100000;
    r = await edit("rolls", R1.id, { roll_id: R2.roll_id });
    ok("edit roll_id to duplicate -> 409", r.s === 409, r.j);
    r = await edit("rolls", R1.id, { roll_id: newSerial });
    ok("edit roll_id", r.s === 200, r.j);

    // --- sale ---
    r = await api("POST", "/sales", { customer_name: "TEST_Customer Edit", roll_id: newSerial, order_date: D });
    ok("create sale on renamed roll", r.s === 200, r.s === 200 ? r.j.order_no : r.j);
    const S = r.j;
    ok("sale roll_serial = new serial", S.roll_serial === newSerial, S.roll_serial);
    r = await edit("sales", S.id, { invoice_no: "X" });
    ok("invoice_no on reserved sale -> 400", r.s === 400, r.j);
    r = await edit("sales", S.id, { customer_name: "TEST_Customer Edited" });
    ok("edit sale customer name", r.s === 200, r.j);
    r = await api("POST", `/sales/${S.id}/invoice`, { invoice_date: D });
    ok("invoice sale", r.s === 200, r.j);
    let sd = (await api("GET", "/sales/" + S.id)).j;
    const total = sd.sale.pricing.total;
    ok("settlement customer synced", sd.settlements.every((s) => s.customer_name === "TEST_Customer Edited"), sd.settlements.map((s) => s.customer_name));
    // roll rename after sale propagates
    const serial2 = newSerial + "B";
    r = await edit("rolls", R1.id, { roll_id: serial2 });
    sd = (await api("GET", "/sales/" + S.id)).j;
    ok("roll rename propagates to sale + settlement roll_serial", r.s === 200 && sd.sale.roll_serial === serial2 && sd.settlements.every((s) => s.roll_serial === serial2), [sd.sale.roll_serial, sd.settlements.map((s) => s.roll_serial)]);

    r = await api("POST", `/sales/${S.id}/collections`, { amount: total / 100, date: D, reference: "TEST-COL-1" });
    ok("full collection", r.s === 200, r.j);
    const C = r.j;
    sd = (await api("GET", "/sales/" + S.id)).j;
    const st = sd.settlements[0];
    L.push("settlement " + JSON.stringify([st.settlement_no, st.principal_recoverable, st.margin_recoverable, st.status]));
    const doc = await upload();
    r = await api("POST", `/settlements/${st.id}/transfers`, { kind: "principal", amount: st.principal_recoverable / 100, date: D, bank_ref: "TEST-UTR-1", doc_id: doc });
    ok("principal transfer initiated", r.s === 200, r.j);
    const T = r.j;
    await recon("after sale+collection+transfer");

    // --- collection / transfer edits ---
    r = await edit("collections", C.id, { amount: String(total / 200) });
    ok("reduce collection below committed transfer -> 409", r.s === 409, r.j);
    r = await edit("transfers", T.id, { amount: String(st.principal_recoverable / 100 + 1) });
    ok("transfer above recoverable -> 400", r.s === 400, r.j);
    r = await edit("transfers", T.id, { amount: "20000", bank_ref: "TEST-UTR-EDIT" });
    ok("edit initiated transfer amount + UTR", r.s === 200, r.j);
    r = await api("POST", `/transfers/${T.id}/verify`);
    ok("verify transfer (admin)", r.s === 200, r.j);
    let bv = (await inv(A0.id)).balances;
    r = await edit("transfers", T.id, { amount: "25000" });
    let bv2 = (await inv(A0.id)).balances;
    ok("edit verified transfer amount updates repaid", r.s === 200 && bv2.repaid - bv.repaid === 500000, [r.s, bv.repaid, bv2.repaid]);
    await recon("after transfer edits");
    // collection reduce to 50% (principal recoverable becomes 15625 < committed 25000) -> 409; reduce to 80% fine
    const c80 = Math.round(total * 0.8) / 100;
    r = await edit("collections", C.id, { amount: String(c80), reference: "TEST-COL-EDIT" });
    sd = (await api("GET", "/sales/" + S.id)).j;
    ok("edit collection to 80% recalcs sale", r.s === 200 && sd.sale.collected === Math.round(total * 0.8) && sd.sale.status === "partially_paid", [r.s, r.j, sd.sale.collected, sd.sale.status, sd.settlements[0].principal_recoverable, sd.settlements[0].margin_recoverable]);
    await recon("after collection edit");
    r = await rm("sales", S.id, "void");
    ok("void sale with collections -> 409", r.s === 409, r.j);
    r = await rm("collections", C.id, "delete");
    ok("delete collection with verified transfer -> 409", r.s === 409, r.j);
    r = await rm("transfers", T.id, "void");
    ok("void verified transfer", r.s === 200, r.j);
    sd = (await api("GET", "/sales/" + S.id)).j;
    ok("voided transfer flagged", sd.transfers.find((t) => t.id === T.id)?.status === "voided", sd.transfers.map((t) => t.status));
    r = await rm("collections", C.id, "delete");
    ok("delete collection", r.s === 200, r.j);
    sd = (await api("GET", "/sales/" + S.id)).j;
    ok("sale back to invoiced, collected 0", sd.sale.collected === 0 && sd.sale.status === "invoiced" && sd.collections.length === 0, [sd.sale.collected, sd.sale.status]);
    await recon("after transfer void + collection delete");

    // --- second sale on R2 (reserved) to test purchase dependency ---
    r = await api("POST", "/sales", { customer_name: "TEST_Customer Reserve", roll_id: R2.roll_id, order_date: D });
    const S2 = r.j;
    r = await rm("purchases", P.id, "void");
    ok("void purchase with reserved/sold rolls -> 409", r.s === 409, r.j);
    r = await edit("purchases", P.id, { base_price: "30000" });
    ok("base price change with rolls sold -> 409", r.s === 409, r.j);
    r = await rm("sales", S2.id, "delete");
    ok("permanent delete reserved sale", r.s === 200, r.j);
    ok("deleted sale gone (404)", (await api("GET", "/sales/" + S2.id)).s === 404);
    r = await rm("sales", S.id, "void");
    ok("void invoiced sale", r.s === 200, r.j);
    rolls = (await api("GET", "/rolls?purchase_id=" + P.id)).j;
    ok("rolls released to in_stock", rolls.every((x) => x.status === "in_stock" && !x.sale_id), rolls.map((x) => x.status));
    const salesList = (await api("GET", "/sales")).j;
    const vs = salesList.find((x) => x.id === S.id);
    ok("voided sale hidden from /sales list", !vs, vs ? vs.status : "hidden");
    await recon("after sale removals");

    // --- purchase void ---
    r = await rm("purchases", P.id, "void");
    ok("void TEST purchase", r.s === 200, r.j);
    ok("voided purchase hidden", !(await api("GET", "/purchases")).j.find((x) => x.id === P.id));
    const bEnd = (await inv(A0.id)).balances;
    ok("allocated restored", bEnd.allocated === b0.allocated, [b0.allocated, bEnd.allocated]);
    await recon("after purchase void");

    // --- investments ---
    r = await api("POST", "/investments", { investor_id: A0.id, amount: 1000, date: D, bank_ref: "TEST-CAP-1" });
    ok("record TEST investment", r.s === 200, r.j);
    const I = r.j;
    r = await edit("investments", I.id, { amount: "2000", bank_ref: "TEST-CAP-EDIT" });
    let bi = (await inv(A0.id)).balances;
    ok("edit investment amount", r.s === 200 && bi.invested === b0.invested + 200000, [r.s, bi.invested]);
    await recon("after investment edit");
    r = await rm("investments", I.id, "delete");
    bi = (await inv(A0.id)).balances;
    ok("delete investment reverses invested", r.s === 200 && bi.invested === b0.invested, [r.s, bi.invested]);

    // --- investor CRUD ---
    r = await api("POST", "/investors", { name: "TEST_Investor Edit", email: "test_inv_edit" + (Date.now() % 100000) + "@example.com" });
    const NI = r.j;
    r = await edit("investors", NI.id, { name: "TEST_Investor Edited", email: A0.email });
    ok("investor email duplicate -> 409", r.s === 409, r.j);
    r = await edit("investors", NI.id, { name: "TEST_Investor Edited", phone: "999" });
    ok("edit investor", r.s === 200, r.j);
    r = await rm("investors", NI.id, "delete");
    ok("delete empty investor", r.s === 200, r.j);
    ok("deleted investor 404", (await api("GET", "/investors/" + NI.id)).s === 404);

    // --- audit ---
    const au = (await api("GET", "/audit?q=RECORD_")).j;
    const ed = au.find((a) => a.action === "RECORD_EDITED" && a.entity === "investors" && a.entity_id === NI.id);
    ok("audit RECORD_EDITED with changes+reason", ed && JSON.stringify(ed).includes("TEST_Investor Edited") && JSON.stringify(ed).includes("TEST_ correction"), ed);
    ok("audit RECORD_VOIDED + RECORD_DELETED present", au.some((a) => a.action === "RECORD_VOIDED") && au.some((a) => a.action === "RECORD_DELETED"));
    L.push("A balances end " + JSON.stringify(bEnd));
    await recon("end");
  } catch (e) { L.push("EXCEPTION " + e.message + " " + e.stack); }
  return L;
}
