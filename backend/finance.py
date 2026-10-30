from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core import (db, AFTER, new_id, now_iso, today_ist, add_days, to_paise, to_bp, bp_of, next_seq, clean, inr,
                  audit, notify_all, post, link_docs, actor)

BAL_KEYS = ["invested", "allocated", "recovered", "repaid", "margin_earned", "margin_paid"]


def balances(inv) -> dict:
    b = {k: int(inv.get(k, 0)) for k in BAL_KEYS}
    b["available"] = b["invested"] - b["allocated"]
    b["deployed"] = b["allocated"] - b["recovered"]
    b["outstanding"] = b["invested"] - b["repaid"]
    b["principal_pending_transfer"] = b["recovered"] - b["repaid"]
    b["margin_payable"] = b["margin_earned"] - b["margin_paid"]
    b["total_transferred"] = b["repaid"] + b["margin_paid"]
    return b


async def get_or_404(coll, q, msg="Not found"):
    d = await db[coll].find_one(q, {"_id": 0})
    if not d:
        raise HTTPException(404, msg)
    return d


# ---------- Investors & terms ----------
async def create_investor(m, d):
    if await db.investors.find_one({"email": d["email"].lower()}):
        raise HTTPException(409, "An investor with this email already exists")
    inv = {"id": new_id(), "code": await next_seq("investor", "INV-", 3), "name": d["name"], "email": d["email"].lower(),
           "phone": d.get("phone", ""), "pan": d.get("pan", ""), "bank_details": d.get("bank_details", ""),
           "created_at": now_iso(), **{k: 0 for k in BAL_KEYS}}
    await db.investors.insert_one(inv)
    await audit(m, "INVESTOR_CREATED", "investor", inv["id"], {"name": inv["name"], "code": inv["code"]})
    return clean(inv)


async def avg_roll_cost(investor_id=None):
    q = {"voided": {"$ne": True}}
    rows = await db.purchases.find({**q, "investor_ids": investor_id}, {"_id": 0}).to_list(2000) if investor_id else []
    if not rows:
        rows = await db.purchases.find(q, {"_id": 0}).to_list(2000)
    qty = sum(p["qty"] for p in rows)
    if not qty:
        return None
    return (sum(p["subtotal"] + p.get("other_charges", 0) for p in rows)) // qty


async def propose_agreement(m, investor_id, d):
    await get_or_404("investors", {"id": investor_id}, "Investor not found")
    if d.get("gst_mode", "full_value") not in ("full_value", "margin_only"):
        raise HTTPException(400, "Invalid GST mode")
    avg = await avg_roll_cost(investor_id)
    if avg is None and not d.get("default_base_price"):
        raise HTTPException(400, "No purchases yet — enter the base price per roll")
    version = await db.agreements.count_documents({"investor_id": investor_id}) + 1
    a = {"id": new_id(), "investor_id": investor_id, "version": version,
         "default_base_price": avg if avg is not None else to_paise(d["default_base_price"]),
         "base_source": "Average purchase value per roll (excl. GST)" if avg is not None else "Entered manually",
         "margin_bp": to_bp(d.get("margin_pct", 30)), "tax_bp": to_bp(d.get("income_tax_pct", 30)),
         "investor_share_bp": to_bp(d.get("investor_share_pct", 50)), "gst_bp": to_bp(d.get("gst_pct", 18)),
         "gst_mode": d.get("gst_mode", "full_value"), "settlement_days": int(d.get("settlement_days", 7)),
         "effective_from": d["effective_from"], "notes": d.get("notes", ""), "status": "pending",
         "created_by": actor(m), "created_by_id": m["user_id"], "created_at": now_iso()}
    if not (0 <= a["margin_bp"] <= 10000 and 0 <= a["investor_share_bp"] <= 10000 and 0 <= a["gst_bp"] <= 5000 and 0 <= a["tax_bp"] <= 10000):
        raise HTTPException(400, "Percentages out of range")
    await db.agreements.insert_one(a)
    await audit(m, "TERMS_PROPOSED", "agreement", a["id"], {k: a[k] for k in ["version", "default_base_price", "margin_bp", "tax_bp", "investor_share_bp", "gst_bp", "gst_mode", "effective_from"]})
    await notify_all([], "terms", "Commercial terms proposed", f"Version {version} awaiting management approval", f"/investors/{investor_id}")
    return clean(a)


async def decide_agreement(m, agreement_id, approve: bool, reason=""):
    a = await get_or_404("agreements", {"id": agreement_id})
    if a["created_by_id"] == m["user_id"] and m["role"] != "admin":
        raise HTTPException(403, "Proposer cannot approve their own terms")
    status = "approved" if approve else "rejected"
    r = await db.agreements.find_one_and_update({"id": agreement_id, "status": "pending"},
                                                {"$set": {"status": status, "approved_by": actor(m), "approved_at": now_iso(), "decision_reason": reason}},
                                                projection={"_id": 0}, return_document=AFTER)
    if not r:
        raise HTTPException(409, "Terms already decided")
    await audit(m, f"TERMS_{status.upper()}", "agreement", agreement_id, {"version": a["version"], "reason": reason})
    await notify_all([a["investor_id"]], "terms", f"Commercial terms {status}", f"Version {a['version']} effective {a['effective_from']}", f"/investors/{a['investor_id']}")
    return r


async def applicable_agreement(investor_id, on_date):
    a = await db.agreements.find({"investor_id": investor_id, "status": "approved", "effective_from": {"$lte": on_date}},
                                 {"_id": 0}).sort([("effective_from", -1), ("version", -1)]).to_list(1)
    if not a:
        inv = await db.investors.find_one({"id": investor_id}, {"name": 1})
        raise HTTPException(400, f"No approved commercial terms effective on {on_date} for {inv['name'] if inv else investor_id}")
    return a[0]


async def record_investment(m, d):
    inv = await get_or_404("investors", {"id": d["investor_id"]}, "Investor not found")
    amt = to_paise(d["amount"])
    if amt <= 0:
        raise HTTPException(400, "Amount must be positive")
    if not d.get("bank_ref"):
        raise HTTPException(400, "Bank transaction reference is required")
    if await db.investments.find_one({"bank_ref": d["bank_ref"]}):
        raise HTTPException(409, "This bank reference has already been recorded")
    doc = {"id": new_id(), "ref_no": await next_seq("investment", "CAP-", 4), "investor_id": inv["id"], "investor_name": inv["name"],
           "investor_ids": [inv["id"]], "amount": amt, "date": d["date"], "bank_ref": d["bank_ref"], "doc_id": d.get("doc_id"),
           "terms_note": d.get("terms_note", ""), "created_by": actor(m), "created_at": now_iso()}
    await db.investments.insert_one(doc)
    await db.investors.update_one({"id": inv["id"]}, {"$inc": {"invested": amt}})
    e = await post(m, "CAPITAL_RECEIVED", amt, d["date"], investor_id=inv["id"], refs={"investment_id": doc["id"]},
                   remarks=f"{doc['ref_no']} · {d['bank_ref']}", doc_ids=[doc["doc_id"]])
    await link_docs([doc["doc_id"]], [inv["id"]])
    await audit(m, "INVESTMENT_RECORDED", "investment", doc["id"], {"amount": amt, "txn_id": e["txn_id"]})
    await notify_all([inv["id"]], "investment", "New investment recorded", f"₹{inr(amt)} received from {inv['name']}", f"/investors/{inv['id']}")
    return clean(doc)


# ---------- Procurement ----------
async def create_purchase_invoice(m, d):
    items = d.get("items") or []
    if not items:
        raise HTTPException(400, "Add at least one product")
    subs = [to_paise(it["unit_cost"]) * int(it["qty"]) for it in items]
    if any(s <= 0 for s in subs):
        raise HTTPException(400, "Each product needs a quantity and a positive cost")
    other, sub_total = to_paise(d.get("other_charges") or 0), sum(subs)
    shares, rem = [], other
    for i, s in enumerate(subs):
        amt = rem if i == len(subs) - 1 else other * s // sub_total
        rem -= amt
        shares.append(amt)
    need = sub_total + other
    for f in d.get("funding") or []:
        inv = await get_or_404("investors", {"id": f["investor_id"]}, "Investor not found")
        amt = bp_of(need, to_bp(f["pct"]))
        if inv.get("invested", 0) - inv.get("allocated", 0) < amt:
            raise HTTPException(400, f"Insufficient available funds for {inv['name']} (needs ₹{inr(amt)})")
    paid_left = to_paise(d.get("amount_paid") or 0)
    group, out = new_id(), []
    for it, s, oc in zip(items, subs, shares):
        line_total = s + bp_of(s, to_bp(it.get("gst_pct", 18))) + oc
        pay = min(paid_left, line_total)
        paid_left -= pay
        out.append(await create_purchase(m, {**d, **it, "other_charges": oc / 100, "amount_paid": pay / 100, "batch_no": "",
                                             "po_number": "", "invoice_group": group}))
    return out


async def create_purchase(m, d):
    qty = int(d["qty"])
    if qty <= 0 or qty > 500:
        raise HTTPException(400, "Quantity must be between 1 and 500")
    funding = d.get("funding") or []
    if not funding:
        raise HTTPException(400, "Investor funding allocation is required")
    pcts = [to_bp(f["pct"]) for f in funding]
    if sum(pcts) != 10000 or any(p <= 0 for p in pcts) or len({f["investor_id"] for f in funding}) != len(funding):
        raise HTTPException(400, "Funding percentages must be positive, unique per investor and total 100%")
    unit_cost = to_paise(d["unit_cost"])
    other = to_paise(d.get("other_charges", 0) or 0)
    subtotal = unit_cost * qty
    base = (subtotal + other) // qty
    if base <= 0 or unit_cost <= 0:
        raise HTTPException(400, "Prices must be positive")
    investors = {}
    for f in funding:
        investors[f["investor_id"]] = await get_or_404("investors", {"id": f["investor_id"]}, "Investor not found")
    per_roll, rem = [], base
    for i, (f, p) in enumerate(zip(funding, pcts)):
        amt = rem if i == len(funding) - 1 else bp_of(base, p)
        rem -= amt
        per_roll.append({"investor_id": f["investor_id"], "investor_name": investors[f["investor_id"]]["name"], "pct_bp": p, "principal": amt})
    year = d["purchase_date"][:4]
    batch = (d.get("batch_no") or "").strip() or await next_seq(f"batch{year}", f"BATCH-{year}-", 3)
    if await db.rolls.find_one({"batch_no": batch}):
        raise HTTPException(409, f"Batch number {batch} already exists")
    serials = [f"{batch}-{i:02d}" for i in range(1, qty + 1)]
    if await db.rolls.find_one({"roll_id": {"$in": serials}}):
        raise HTTPException(409, "Roll IDs for this batch already exist")
    gst = bp_of(subtotal, to_bp(d.get("gst_pct", 18)))
    total = subtotal + gst + other
    paid = min(to_paise(d.get("amount_paid", 0) or 0), total)

    done = []
    for f in per_roll:
        amt = f["principal"] * qty
        r = await db.investors.find_one_and_update(
            {"id": f["investor_id"], "$expr": {"$gte": [{"$subtract": ["$invested", "$allocated"]}, amt]}},
            {"$inc": {"allocated": amt}})
        if not r:
            for x in done:
                await db.investors.update_one({"id": x[0]}, {"$inc": {"allocated": -x[1]}})
            raise HTTPException(400, f"Insufficient available funds for {f['investor_name']} (needs ₹{inr(amt)})")
        done.append((f["investor_id"], amt))

    pid = new_id()
    po = d.get("po_number") or await next_seq("po", "PO-", 4)
    inv_ids = [f["investor_id"] for f in per_roll]
    purchase = {"id": pid, "po_number": po, "batch_no": batch, "supplier": d["supplier"], "supplier_invoice": d["supplier_invoice"],
                "purchase_date": d["purchase_date"], "brand": d["brand"], "series": d.get("series", ""),
                "thickness": d.get("thickness", ""), "specs": d.get("specs", ""), "qty": qty, "unit_cost": unit_cost,
                "gst_pct": d.get("gst_pct", 18), "gst": gst, "other_charges": other, "subtotal": subtotal, "total": total,
                "amount_paid": paid, "payment_status": "paid" if paid >= total else ("partial" if paid else "unpaid"),
                "base_price": base, "funding": per_roll, "investor_ids": inv_ids,
                "invoice_doc_id": d.get("invoice_doc_id"), "payment_doc_id": d.get("payment_doc_id"),
                "principal_allocated": base * qty, "invoice_group": d.get("invoice_group"), "created_by": actor(m), "created_at": now_iso()}
    landed = total // qty
    rolls = [{"id": new_id(), "roll_id": s, "batch_no": batch, "purchase_id": pid, "po_number": po, "brand": purchase["brand"],
              "series": purchase["series"], "thickness": purchase["thickness"], "specs": purchase["specs"],
              "unit_cost": unit_cost, "landed_cost": landed, "base_price": base, "funding": per_roll,
              "investor_ids": inv_ids, "status": "in_stock", "sale_id": None, "purchase_date": d["purchase_date"],
              "created_at": now_iso(), "status_history": [{"status": "in_stock", "at": now_iso(), "by": actor(m)}]}
             for s in serials]
    try:
        await db.rolls.insert_many(rolls)
    except DuplicateKeyError:
        await db.rolls.delete_many({"purchase_id": pid})
        for x in done:
            await db.investors.update_one({"id": x[0]}, {"$inc": {"allocated": -x[1]}})
        raise HTTPException(409, "Roll serial conflict, purchase not saved")
    await db.purchases.insert_one(purchase)
    docs = [purchase["invoice_doc_id"], purchase["payment_doc_id"]]
    await post(m, "INVENTORY_PURCHASE", total, d["purchase_date"], investor_ids=inv_ids, refs={"purchase_id": pid},
               remarks=f"{po} · batch {batch} · {qty} rolls · {purchase['supplier']} inv {purchase['supplier_invoice']}", doc_ids=docs)
    for f in per_roll:
        await post(m, "FUNDS_ALLOCATED", f["principal"] * qty, d["purchase_date"], investor_id=f["investor_id"],
                   refs={"purchase_id": pid}, remarks=f"{po} · {qty} × ₹{inr(f['principal'])}")
    if paid:
        await post(m, "SUPPLIER_PAYMENT", paid, d["purchase_date"], investor_ids=inv_ids, refs={"purchase_id": pid},
                   remarks=f"{po} supplier payment", doc_ids=[purchase["payment_doc_id"]])
    await link_docs(docs, inv_ids)
    await audit(m, "PURCHASE_RECORDED", "purchase", pid, {"po": po, "qty": qty, "total": total, "principal": base * qty})
    await notify_all(inv_ids, "purchase", "New PPF purchase entered", f"{po}: {qty} rolls of {purchase['brand']} {purchase['series']}", "/purchases")
    for iid in inv_ids:
        inv = await db.investors.find_one({"id": iid}, {"_id": 0})
        if balances(inv)["available"] < base:
            await notify_all([iid], "low_funds", "Low available investment funds",
                             f"{inv['name']}: ₹{inr(balances(inv)['available'])} available — below one roll", f"/investors/{iid}")
    return clean(purchase)


async def record_supplier_payment(m, purchase_id, d):
    p = await get_or_404("purchases", {"id": purchase_id})
    amt = to_paise(d["amount"])
    if amt <= 0:
        raise HTTPException(400, "Amount must be positive")
    r = await db.purchases.find_one_and_update({"id": purchase_id, "$expr": {"$lte": [{"$add": ["$amount_paid", amt]}, "$total"]}},
                                               {"$inc": {"amount_paid": amt}}, projection={"_id": 0}, return_document=AFTER)
    if not r:
        raise HTTPException(400, "Payment exceeds supplier invoice balance")
    status = "paid" if r["amount_paid"] >= r["total"] else "partial"
    await db.purchases.update_one({"id": purchase_id}, {"$set": {"payment_status": status}})
    await post(m, "SUPPLIER_PAYMENT", amt, d["date"], investor_ids=p["investor_ids"], refs={"purchase_id": purchase_id},
               remarks=f"{p['po_number']} · {d.get('reference', '')}", doc_ids=[d.get("doc_id")])
    await link_docs([d.get("doc_id")], p["investor_ids"])
    await audit(m, "SUPPLIER_PAYMENT", "purchase", purchase_id, {"amount": amt, "ref": d.get("reference")})
    return {**r, "payment_status": status}


# ---------- Pricing & sales ----------
def compute_pricing(base, funding, agreements):
    lines, total_margin, ws, tax_total = [], 0, 0, 0
    for f in funding:
        a = agreements[f["investor_id"]]
        margin = bp_of(f["principal"], a["margin_bp"])
        tax = bp_of(margin, a.get("tax_bp", 0))
        net = margin - tax
        inv_m = bp_of(net, a["investor_share_bp"])
        lines.append({"investor_id": f["investor_id"], "investor_name": f.get("investor_name", ""), "principal": f["principal"],
                      "margin": margin, "income_tax": tax, "net_margin": net, "investor_margin": inv_m, "wheelspa_margin": net - inv_m,
                      "agreement_id": a["id"], "agreement_version": a["version"], "margin_bp": a["margin_bp"], "tax_bp": a.get("tax_bp", 0),
                      "investor_share_bp": a["investor_share_bp"], "settlement_days": a["settlement_days"]})
        total_margin += margin
        tax_total += tax
        ws += net - inv_m
    primary = agreements[max(funding, key=lambda f: f["principal"])["investor_id"]]
    taxable = base + total_margin
    gst = bp_of(taxable if primary["gst_mode"] == "full_value" else total_margin, primary["gst_bp"])
    return {"base": base, "margin": total_margin, "income_tax": tax_total, "tax_bp": primary.get("tax_bp", 0),
            "net_margin": total_margin - tax_total, "investor_margin": total_margin - tax_total - ws, "wheelspa_margin": ws,
            "taxable": taxable, "gst": gst, "gst_bp": primary["gst_bp"], "gst_mode": primary["gst_mode"],
            "total": taxable + gst, "lines": lines}


async def find_roll(ref):
    r = await db.rolls.find_one({"$or": [{"id": ref}, {"roll_id": ref}]}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Roll not found")
    return r


async def price_roll(roll, on_date):
    ags = {f["investor_id"]: await applicable_agreement(f["investor_id"], on_date) for f in roll["funding"]}
    return compute_pricing(roll["base_price"], roll["funding"], ags)


async def create_sale(m, d):
    roll = await find_roll(d["roll_id"])
    if roll["status"] != "in_stock":
        raise HTTPException(409, f"Roll {roll['roll_id']} is not available (status: {roll['status']})")
    pricing = await price_roll(roll, d["order_date"])
    sid = new_id()
    r = await db.rolls.find_one_and_update({"id": roll["id"], "status": "in_stock"},
                                           {"$set": {"status": "reserved", "sale_id": sid},
                                            "$push": {"status_history": {"status": "reserved", "at": now_iso(), "by": actor(m)}}})
    if not r:
        raise HTTPException(409, "Roll was just reserved by another order")
    sale = {"id": sid, "order_no": await next_seq("so", "SO-", 5), "customer_name": d["customer_name"],
            "customer_code": d.get("customer_code", ""), "vehicle": d.get("vehicle", ""), "roll_ref": roll["id"],
            "roll_serial": roll["roll_id"], "product": f"{roll['brand']} {roll['series']}".strip(), "order_date": d["order_date"],
            "pricing": pricing, "investor_ids": roll["investor_ids"], "status": "reserved", "active": True,
            "collected": 0, "ws_recognized": 0, "gst_collected": 0, "tax_recognized": 0, "invoice_no": None, "invoice_date": None,
            "invoice_doc_id": None, "remarks": d.get("remarks", ""), "created_by": actor(m), "created_at": now_iso()}
    try:
        await db.sales.insert_one(sale)
    except DuplicateKeyError:
        await db.rolls.update_one({"id": roll["id"]}, {"$set": {"status": "in_stock", "sale_id": None}})
        raise HTTPException(409, "This roll already has an active sale")
    for ln in pricing["lines"]:
        await db.settlements.insert_one({
            "id": new_id(), "settlement_no": await next_seq("stl", "STL-", 5), "sale_id": sid, "order_no": sale["order_no"],
            "roll_serial": roll["roll_id"], "customer_name": sale["customer_name"], "investor_id": ln["investor_id"],
            "investor_name": ln["investor_name"], "investor_ids": [ln["investor_id"]], "principal_due": ln["principal"],
            "margin_due": ln["investor_margin"], "principal_recoverable": 0, "margin_recoverable": 0,
            "principal_committed": 0, "margin_committed": 0, "principal_paid": 0, "margin_paid": 0,
            "settlement_days": ln["settlement_days"], "due_date": None, "last_collection_date": None,
            "ack": None, "active": True, "created_at": now_iso()})
    await audit(m, "SALE_CREATED", "sale", sid, {"order_no": sale["order_no"], "roll": roll["roll_id"], "total": pricing["total"]})
    await notify_all(roll["investor_ids"], "sale", "Roll reserved for order", f"{sale['order_no']} reserved roll {roll['roll_id']}", f"/sales/{sid}")
    return clean(sale)


DEFAULT_TERMS = {"id": None, "version": 0, "margin_bp": 3000, "tax_bp": 3000, "investor_share_bp": 5000, "gst_bp": 1800,
                 "gst_mode": "full_value", "settlement_days": 7}


async def price_batch(purchase_id, qty, on_date, margin_pct=None):
    roll = await db.rolls.find_one({"purchase_id": purchase_id, "voided": {"$ne": True}}, {"_id": 0})
    if not roll:
        raise HTTPException(404, "Purchase batch not found")
    ags = {}
    for f in roll["funding"]:
        a = await db.agreements.find({"investor_id": f["investor_id"], "status": "approved", "effective_from": {"$lte": on_date}},
                                     {"_id": 0}).sort([("effective_from", -1), ("version", -1)]).to_list(1)
        ags[f["investor_id"]] = dict(a[0] if a else DEFAULT_TERMS)
        if margin_pct is not None:
            if not 0 <= float(margin_pct) <= 500:
                raise HTTPException(400, "Margin must be between 0% and 500%")
            ags[f["investor_id"]]["margin_bp"] = to_bp(margin_pct)
    funding = [{**f, "principal": f["principal"] * qty} for f in roll["funding"]]
    return roll, compute_pricing(roll["base_price"] * qty, funding, ags)


async def create_direct_sale(m, d):
    qty = int(d["qty"])
    if qty < 1:
        raise HTTPException(400, "Quantity must be at least 1")
    p = await get_or_404("purchases", {"id": d["purchase_id"], "voided": {"$ne": True}}, "Purchase batch not found")
    stock = await db.rolls.count_documents({"purchase_id": p["id"], "status": "in_stock", "voided": {"$ne": True}})
    if stock < qty:
        raise HTTPException(400, f"Only {stock} rolls in stock in batch {p['batch_no']}")
    roll, pricing = await price_batch(p["id"], qty, d["sale_date"], d.get("margin_pct"))
    received = to_paise(d.get("amount_received") or 0)
    if received < 0 or received > pricing["total"]:
        raise HTTPException(400, f"Amount received cannot exceed the sale total of ₹{inr(pricing['total'])}")
    if received and not (d.get("payment_reference") or "").strip():
        raise HTTPException(400, "Enter the payment reference for the amount received")
    sid, taken = new_id(), []
    hist = {"status": "sold", "at": now_iso(), "by": actor(m)}
    for _ in range(qty):
        r = await db.rolls.find_one_and_update({"purchase_id": p["id"], "status": "in_stock", "voided": {"$ne": True}},
                                               {"$set": {"status": "sold", "sale_id": sid}, "$push": {"status_history": hist}},
                                               sort=[("roll_id", 1)], projection={"_id": 0, "id": 1})
        if not r:
            break
        taken.append(r["id"])
    label = f"{qty} roll{'s' if qty > 1 else ''} · {p['batch_no']}"
    sale = {"id": sid, "order_no": await next_seq("sale", "SALE-", 5), "customer_name": d["customer_name"],
            "customer_code": d.get("customer_code", ""), "vehicle": d.get("vehicle", ""), "qty": qty, "roll_refs": taken,
            "roll_ref": taken[0] if taken else None, "roll_serial": label, "purchase_id": p["id"], "batch_no": p["batch_no"],
            "po_number": p["po_number"], "product": f"{roll['brand']} {roll['series']}".strip(), "order_date": d["sale_date"],
            "pricing": pricing, "investor_ids": roll["investor_ids"], "status": "invoiced", "active": True,
            "collected": 0, "ws_recognized": 0, "gst_collected": 0, "tax_recognized": 0,
            "invoice_no": (d.get("invoice_no") or "").strip() or await next_seq("inv", "WS-INV-", 5), "invoice_date": d["sale_date"],
            "invoice_doc_id": d.get("doc_id"), "remarks": d.get("remarks", ""), "created_by": actor(m), "created_at": now_iso()}
    ok = len(taken) == qty
    if ok:
        try:
            await db.sales.insert_one(sale)
        except DuplicateKeyError:
            ok = False
    if not ok:
        await db.rolls.update_many({"id": {"$in": taken}}, {"$set": {"status": "in_stock", "sale_id": None}, "$pop": {"status_history": 1}})
        raise HTTPException(409, "Stock changed while saving, please try again")
    for ln in pricing["lines"]:
        await db.settlements.insert_one({
            "id": new_id(), "settlement_no": await next_seq("stl", "STL-", 5), "sale_id": sid, "order_no": sale["order_no"],
            "roll_serial": label, "customer_name": sale["customer_name"], "investor_id": ln["investor_id"],
            "investor_name": ln["investor_name"], "investor_ids": [ln["investor_id"]], "principal_due": ln["principal"],
            "margin_due": ln["investor_margin"], "principal_recoverable": 0, "margin_recoverable": 0,
            "principal_committed": 0, "margin_committed": 0, "principal_paid": 0, "margin_paid": 0,
            "settlement_days": ln["settlement_days"], "due_date": None, "last_collection_date": None,
            "ack": None, "active": True, "created_at": now_iso()})
    refs = {"sale_id": sid, "roll_id": sale["roll_ref"]}
    await post(m, "SALE_INVOICED", pricing["total"], sale["invoice_date"], investor_ids=sale["investor_ids"], refs=refs,
               remarks=f"{sale['order_no']} · {sale['invoice_no']} · {label} (receivable)", doc_ids=[sale["invoice_doc_id"]])
    await post(m, "GST_PAYABLE", pricing["gst"], sale["invoice_date"], investor_ids=sale["investor_ids"], refs=refs,
               remarks=f"{sale['order_no']} GST @ {pricing['gst_bp']/100:g}% (not distributable)")
    await link_docs([sale["invoice_doc_id"]], sale["investor_ids"])
    await audit(m, "SALE_RECORDED", "sale", sid, {"order_no": sale["order_no"], "qty": qty, "batch": p["batch_no"], "total": pricing["total"]})
    await notify_all(sale["investor_ids"], "sale", "New sale", f"{label} sold on {sale['order_no']} for ₹{inr(pricing['total'])}", f"/sales/{sid}")
    if received:
        await record_collection(m, sid, {"amount": received / 100, "date": d["sale_date"], "mode": d.get("payment_mode") or "Bank transfer",
                                         "reference": d["payment_reference"].strip(), "doc_id": None})
    return clean(await db.sales.find_one({"id": sid}, {"_id": 0}))


async def invoice_sale(m, sale_id, d):
    s = await db.sales.find_one_and_update(
        {"id": sale_id, "status": "reserved"},
        {"$set": {"status": "invoiced", "invoice_no": d.get("invoice_no") or await next_seq("inv", "WS-INV-", 5),
                  "invoice_date": d.get("invoice_date") or today_ist(), "invoice_doc_id": d.get("doc_id")}},
        projection={"_id": 0}, return_document=AFTER)
    if not s:
        raise HTTPException(409, "Order is not awaiting invoice")
    await db.rolls.update_one({"id": s["roll_ref"]}, {"$set": {"status": "sold"},
                                                      "$push": {"status_history": {"status": "sold", "at": now_iso(), "by": actor(m)}}})
    p, refs = s["pricing"], {"sale_id": sale_id, "roll_id": s["roll_ref"]}
    await post(m, "SALE_INVOICED", p["total"], s["invoice_date"], investor_ids=s["investor_ids"], refs=refs,
               remarks=f"{s['order_no']} · {s['invoice_no']} · roll {s['roll_serial']} (receivable)", doc_ids=[s["invoice_doc_id"]])
    await post(m, "GST_PAYABLE", p["gst"], s["invoice_date"], investor_ids=s["investor_ids"], refs=refs,
               remarks=f"{s['order_no']} GST @ {p['gst_bp']/100:g}% (not distributable)")
    await link_docs([s["invoice_doc_id"]], s["investor_ids"])
    await audit(m, "SALE_INVOICED", "sale", sale_id, {"invoice_no": s["invoice_no"], "total": p["total"]})
    await notify_all(s["investor_ids"], "sale", "New roll sold", f"Roll {s['roll_serial']} invoiced on {s['order_no']} for ₹{inr(p['total'])}", f"/sales/{sale_id}")
    return s


async def cancel_sale(m, sale_id, reason):
    s = await db.sales.find_one_and_update({"id": sale_id, "status": "reserved", "collected": 0},
                                           {"$set": {"status": "cancelled", "active": False, "cancel_reason": reason}},
                                           projection={"_id": 0}, return_document=AFTER)
    if not s:
        raise HTTPException(409, "Only un-invoiced orders without collections can be cancelled")
    await db.rolls.update_one({"id": s["roll_ref"], "sale_id": sale_id}, {"$set": {"status": "in_stock", "sale_id": None},
                              "$push": {"status_history": {"status": "in_stock", "at": now_iso(), "by": actor(m), "reason": "order cancelled"}}})
    await db.settlements.update_many({"sale_id": sale_id}, {"$set": {"active": False}})
    await audit(m, "SALE_CANCELLED", "sale", sale_id, {"reason": reason})
    return s


async def _bump(coll, id_, field, new):
    before = await db[coll].find_one_and_update({"id": id_, field: {"$lt": new}}, {"$set": {field: new}})
    return new - before[field] if before else 0


async def record_collection(m, sale_id, d):
    s = await get_or_404("sales", {"id": sale_id}, "Sale not found")
    if s["status"] not in ("invoiced", "partially_paid"):
        raise HTTPException(400, "Collections can only be recorded on invoiced, unpaid orders")
    amt = to_paise(d["amount"])
    if amt <= 0:
        raise HTTPException(400, "Amount must be positive")
    if not d.get("reference"):
        raise HTTPException(400, "Payment reference is required")
    p = s["pricing"]
    total = p["total"]
    upd = await db.sales.find_one_and_update({"id": sale_id, "collected": {"$lte": total - amt}}, {"$inc": {"collected": amt}},
                                             projection={"_id": 0}, return_document=AFTER)
    if not upd:
        raise HTTPException(400, f"Amount exceeds outstanding receivable of ₹{inr(total - s['collected'])}")
    col = upd["collected"]
    await db.sales.update_one({"id": sale_id}, {"$set": {"status": "paid" if col >= total else "partially_paid"}})
    frac = (lambda x: x) if col >= total else (lambda x: x * col // total)
    c = {"id": new_id(), "receipt_no": await next_seq("rcpt", "RCP-", 5), "sale_id": sale_id, "order_no": s["order_no"],
         "investor_ids": s["investor_ids"], "amount": amt, "date": d["date"], "mode": d.get("mode", "Bank transfer"),
         "reference": d["reference"], "doc_id": d.get("doc_id"), "created_by": actor(m), "created_at": now_iso()}
    await db.collections.insert_one(c)
    refs = {"sale_id": sale_id, "roll_id": s["roll_ref"], "collection_id": c["id"]}
    await post(m, "CUSTOMER_PAYMENT", amt, d["date"], investor_ids=s["investor_ids"], refs=refs,
               remarks=f"{s['order_no']} · {c['receipt_no']} · {c['reference']}", doc_ids=[c["doc_id"]])
    async for st in db.settlements.find({"sale_id": sale_id, "active": True}, {"_id": 0}):
        dp = await _bump("settlements", st["id"], "principal_recoverable", frac(st["principal_due"]))
        dm = await _bump("settlements", st["id"], "margin_recoverable", frac(st["margin_due"]))
        await db.settlements.update_one({"id": st["id"]}, {"$set": {"last_collection_date": d["date"],
                                        "due_date": add_days(d["date"], st["settlement_days"])}})
        await db.investors.update_one({"id": st["investor_id"]}, {"$inc": {"recovered": dp, "margin_earned": dm}})
        r2 = {**refs, "settlement_id": st["id"]}
        if dp:
            await post(m, "PRINCIPAL_RECOVERED", dp, d["date"], investor_id=st["investor_id"], refs=r2,
                       remarks=f"{s['order_no']} principal collected for roll {s['roll_serial']} (pending transfer)")
        if dm:
            await post(m, "INVESTOR_MARGIN_EARNED", dm, d["date"], investor_id=st["investor_id"], refs=r2,
                       remarks=f"{s['order_no']} investor margin earned (payable)")
    dws = await _bump("sales", sale_id, "ws_recognized", frac(p["wheelspa_margin"]))
    dg = await _bump("sales", sale_id, "gst_collected", frac(p["gst"]))
    dt = await _bump("sales", sale_id, "tax_recognized", frac(p.get("income_tax", 0)))
    if dt:
        await post(m, "INCOME_TAX", dt, d["date"], investor_ids=s["investor_ids"], refs=refs, remarks=f"{s['order_no']} income tax @ {p.get('tax_bp', 0)/100:g}% on margin")
    if dws:
        await post(m, "WHEELSPA_MARGIN", dws, d["date"], investor_ids=s["investor_ids"], refs=refs, remarks=f"{s['order_no']} Wheelspa margin")
    if dg:
        await post(m, "GST_COLLECTED", dg, d["date"], investor_ids=s["investor_ids"], refs=refs, remarks=f"{s['order_no']} GST collected (tax liability)")
    await link_docs([c["doc_id"]], s["investor_ids"])
    await audit(m, "COLLECTION_RECORDED", "sale", sale_id, {"amount": amt, "receipt": c["receipt_no"]})
    await notify_all(s["investor_ids"], "collection", "Customer payment received", f"₹{inr(amt)} received on {s['order_no']}", f"/sales/{sale_id}")
    return clean(c)


# ---------- Settlements ----------
def settlement_status(st, sale=None, open_query=False):
    if not st.get("active", True):
        return "cancelled"
    if st["principal_paid"] >= st["principal_due"] and st["margin_paid"] >= st["margin_due"]:
        return "settled"
    if sale and sale.get("status") == "reserved":
        return "awaiting_invoice"
    if st["principal_recoverable"] == 0 and st["margin_recoverable"] == 0:
        return "awaiting_collection"
    unpaid = (st["principal_recoverable"] - st["principal_paid"]) + (st["margin_recoverable"] - st["margin_paid"])
    uncommitted = (st["principal_recoverable"] - st["principal_committed"]) + (st["margin_recoverable"] - st["margin_committed"])
    if uncommitted > 0 and st.get("due_date") and st["due_date"] < today_ist():
        return "overdue"
    if (st["principal_committed"] + st["margin_committed"]) > (st["principal_paid"] + st["margin_paid"]):
        return "verification_pending"
    if unpaid > 0:
        return "transfer_pending"
    return "partially_settled"


async def enrich_settlement(st):
    sale = await db.sales.find_one({"id": st["sale_id"]}, {"_id": 0, "status": 1, "collected": 1, "pricing.total": 1})
    oq = await db.queries.count_documents({"settlement_id": st["id"], "status": {"$ne": "closed"}}) > 0
    st["status"] = settlement_status(st, sale, oq)
    st["open_query"] = oq
    st["sale_status"] = sale["status"] if sale else None
    st["outstanding_principal"] = st["principal_due"] - st["principal_paid"]
    st["outstanding_margin"] = st["margin_due"] - st["margin_paid"]
    return st


async def create_transfer(m, settlement_id, d):
    kind = d["kind"]
    if kind not in ("principal", "margin"):
        raise HTTPException(400, "Invalid transfer kind")
    amt = to_paise(d["amount"])
    if amt <= 0:
        raise HTTPException(400, "Amount must be positive")
    if not d.get("bank_ref") or not d.get("doc_id"):
        raise HTTPException(400, "Bank reference and transfer proof are required")
    rec, com = f"{kind}_recoverable", f"{kind}_committed"
    st = await db.settlements.find_one_and_update(
        {"id": settlement_id, "active": True, "$expr": {"$lte": [{"$add": [f"${com}", amt]}, f"${rec}"]}},
        {"$inc": {com: amt}}, projection={"_id": 0}, return_document=AFTER)
    if not st:
        cur = await get_or_404("settlements", {"id": settlement_id}, "Settlement not found")
        avail = cur[rec] - cur[com]
        raise HTTPException(400, f"Exceeds {kind} recoverable from actual collections (max ₹{inr(avail)})")
    t = {"id": new_id(), "transfer_no": await next_seq("trf", "TRF-", 5), "settlement_id": settlement_id, "sale_id": st["sale_id"],
         "order_no": st["order_no"], "roll_serial": st["roll_serial"], "investor_id": st["investor_id"],
         "investor_ids": [st["investor_id"]], "kind": kind, "amount": amt, "date": d["date"], "bank_ref": d["bank_ref"],
         "doc_id": d["doc_id"], "status": "initiated", "created_by": actor(m), "created_by_id": m["user_id"], "created_at": now_iso()}
    await db.transfers.insert_one(t)
    await link_docs([t["doc_id"]], [st["investor_id"]])
    label = "Principal repayment" if kind == "principal" else "Investor margin payment"
    await audit(m, "TRANSFER_INITIATED", "transfer", t["id"], {"kind": kind, "amount": amt, "bank_ref": t["bank_ref"]})
    await notify_all([st["investor_id"]], f"{kind}_initiated", f"{label} initiated", f"₹{inr(amt)} on {st['order_no']} · UTR {t['bank_ref']}", f"/sales/{st['sale_id']}")
    return clean(t)


async def verify_transfer(m, transfer_id):
    t = await get_or_404("transfers", {"id": transfer_id}, "Transfer not found")
    if t["created_by_id"] == m["user_id"] and m["role"] != "admin":
        raise HTTPException(403, "The uploader cannot verify their own transfer")
    t = await db.transfers.find_one_and_update({"id": transfer_id, "status": "initiated"},
                                               {"$set": {"status": "verified", "verified_by": actor(m), "verified_at": now_iso()}},
                                               projection={"_id": 0}, return_document=AFTER)
    if not t:
        raise HTTPException(409, "Transfer is not awaiting verification")
    k = t["kind"]
    await db.settlements.update_one({"id": t["settlement_id"]}, {"$inc": {f"{k}_paid": t["amount"]}})
    await db.investors.update_one({"id": t["investor_id"]}, {"$inc": {"repaid" if k == "principal" else "margin_paid": t["amount"]}})
    await post(m, "PRINCIPAL_REPAYMENT" if k == "principal" else "INVESTOR_MARGIN_PAID", t["amount"], t["date"],
               investor_id=t["investor_id"], refs={"sale_id": t["sale_id"], "settlement_id": t["settlement_id"], "transfer_id": t["id"]},
               remarks=f"{t['order_no']} · {t['transfer_no']} · UTR {t['bank_ref']} (verified)", doc_ids=[t["doc_id"]])
    await audit(m, "TRANSFER_VERIFIED", "transfer", transfer_id, {"kind": k, "amount": t["amount"]})
    title = "Principal repayment verified" if k == "principal" else "Investor margin payment completed"
    await notify_all([t["investor_id"]], f"{k}_verified", title, f"₹{inr(t['amount'])} on {t['order_no']}", f"/sales/{t['sale_id']}")
    return t


async def reject_transfer(m, transfer_id, reason):
    t = await db.transfers.find_one_and_update({"id": transfer_id, "status": "initiated"},
                                               {"$set": {"status": "rejected", "rejected_by": actor(m), "reject_reason": reason, "rejected_at": now_iso()}},
                                               projection={"_id": 0}, return_document=AFTER)
    if not t:
        raise HTTPException(409, "Transfer is not awaiting verification")
    await db.settlements.update_one({"id": t["settlement_id"]}, {"$inc": {f"{t['kind']}_committed": -t["amount"]}})
    await audit(m, "TRANSFER_REJECTED", "transfer", transfer_id, {"reason": reason})
    await notify_all([t["investor_id"]], "transfer_rejected", "Transfer proof rejected", f"{t['transfer_no']}: {reason}", f"/sales/{t['sale_id']}")
    return t


async def acknowledge(m, settlement_id, note):
    st = await get_or_404("settlements", {"id": settlement_id, "investor_id": m.get("investor_id") or "__none__"}, "Settlement not found")
    if st["principal_paid"] + st["margin_paid"] == 0:
        raise HTTPException(400, "Nothing has been transferred and verified on this settlement yet")
    ack = {"by": actor(m), "at": now_iso(), "note": note, "principal_paid": st["principal_paid"], "margin_paid": st["margin_paid"]}
    await db.settlements.update_one({"id": settlement_id}, {"$set": {"ack": ack}, "$push": {"ack_history": ack}})
    await audit(m, "SETTLEMENT_ACKNOWLEDGED", "settlement", settlement_id, ack)
    await notify_all([], "ack", "Investor acknowledged settlement", f"{st['order_no']} acknowledged by {actor(m)}", f"/sales/{st['sale_id']}")
    return ack


async def run_alerts():
    async for st in db.settlements.find({"active": True, "overdue_notified": {"$ne": True}, "due_date": {"$lt": today_ist()}}, {"_id": 0}):
        if settlement_status(st) == "overdue":
            await db.settlements.update_one({"id": st["id"]}, {"$set": {"overdue_notified": True}})
            await notify_all([st["investor_id"]], "overdue", "Settlement overdue",
                             f"{st['order_no']} was due on {st['due_date']}", f"/sales/{st['sale_id']}")
