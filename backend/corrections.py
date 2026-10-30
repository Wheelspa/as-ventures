from fastapi import HTTPException

from core import db, to_paise, to_bp, bp_of, now_iso, audit, post, actor
from finance import get_or_404, BAL_KEYS

NV = {"voided": {"$ne": True}}
DESC = {
    "investors": ["name", "email", "phone", "pan", "bank_details"],
    "investments": ["bank_ref", "terms_note", "date"],
    "purchases": ["po_number", "supplier", "supplier_invoice", "purchase_date", "brand", "series", "thickness", "specs"],
    "rolls": ["roll_id", "brand", "series", "thickness", "specs"],
    "sales": ["customer_name", "customer_code", "vehicle", "remarks", "invoice_no", "invoice_date"],
    "collections": ["mode", "reference", "date"],
    "transfers": ["bank_ref", "date"],
}
MONEY = {"investments": ["amount"], "purchases": ["unit_cost", "other_charges", "amount_paid"],
         "collections": ["amount"], "transfers": ["amount"]}
REMOVABLE = {"investors", "investments", "purchases", "sales", "collections", "transfers"}
ROLL_PROPAGATE = ["po_number", "brand", "series", "thickness", "specs"]
DATE_LEDGER = {
    "investments": {"date": ("investment_id", None)},
    "collections": {"date": ("collection_id", None)},
    "transfers": {"date": ("transfer_id", None)},
    "purchases": {"purchase_date": ("purchase_id", ["INVENTORY_PURCHASE", "FUNDS_ALLOCATED", "SUPPLIER_PAYMENT"])},
    "sales": {"invoice_date": ("sale_id", ["SALE_INVOICED", "GST_PAYABLE"])},
}


def _reason(r):
    if not r or len(r.strip()) < 3:
        raise HTTPException(400, "A reason is required")
    return r.strip()


# ---------- Collection resync (used by edit / void / delete of a customer payment) ----------
async def _plan_resync(sale, newc):
    total = sale["pricing"]["total"]
    frac = (lambda x: x) if newc >= total else (lambda x: x * newc // total)
    plan = []
    async for st in db.settlements.find({"sale_id": sale["id"], "active": True}, {"_id": 0}):
        tp, tm = frac(st["principal_due"]), frac(st["margin_due"])
        if tp < st["principal_committed"] or tm < st["margin_committed"]:
            raise HTTPException(409, f"{st['settlement_no']}: transfers already exceed what this change would leave collected. Void those transfers first.")
        plan.append((st, tp, tm))
    return plan, frac


async def _apply_collection_delta(m, sale, col, delta, reason):
    total = sale["pricing"]["total"]
    newc = sale["collected"] + delta
    if newc < 0 or newc > total:
        raise HTTPException(400, f"Collected amount must stay between ₹0 and the invoice total")
    plan, frac = await _plan_resync(sale, newc)
    r = await db.sales.update_one({"id": sale["id"], "collected": sale["collected"]}, {"$set": {"collected": newc}})
    if not r.modified_count:
        raise HTTPException(409, "Order changed meanwhile, retry")
    refs = {"sale_id": sale["id"], "roll_id": sale["roll_ref"], "collection_id": col["id"]}
    note = f"Correction {col['receipt_no']}: {reason}"
    d = col["date"]
    await post(m, "CUSTOMER_PAYMENT", delta, d, investor_ids=sale["investor_ids"], refs=refs, remarks=note, reason=reason)
    for st, tp, tm in plan:
        dp, dm = tp - st["principal_recoverable"], tm - st["margin_recoverable"]
        upd = {"principal_recoverable": tp, "margin_recoverable": tm}
        if newc == 0:
            upd.update({"due_date": None, "last_collection_date": None})
        await db.settlements.update_one({"id": st["id"]}, {"$set": upd})
        await db.investors.update_one({"id": st["investor_id"]}, {"$inc": {"recovered": dp, "margin_earned": dm}})
        r2 = {**refs, "settlement_id": st["id"]}
        if dp:
            await post(m, "PRINCIPAL_RECOVERED", dp, d, investor_id=st["investor_id"], refs=r2, remarks=note, reason=reason)
        if dm:
            await post(m, "INVESTOR_MARGIN_EARNED", dm, d, investor_id=st["investor_id"], refs=r2, remarks=note, reason=reason)
    p = sale["pricing"]
    dws, dg = frac(p["wheelspa_margin"]) - sale["ws_recognized"], frac(p["gst"]) - sale["gst_collected"]
    dt = frac(p.get("income_tax", 0)) - sale.get("tax_recognized", 0)
    status = "paid" if newc >= total else ("partially_paid" if newc else "invoiced")
    await db.sales.update_one({"id": sale["id"]}, {"$set": {"ws_recognized": frac(p["wheelspa_margin"]), "gst_collected": frac(p["gst"]),
                                                       "tax_recognized": frac(p.get("income_tax", 0)), "status": status}})
    if dt:
        await post(m, "INCOME_TAX", dt, d, investor_ids=sale["investor_ids"], refs=refs, remarks=note, reason=reason)
    if dws:
        await post(m, "WHEELSPA_MARGIN", dws, d, investor_ids=sale["investor_ids"], refs=refs, remarks=note, reason=reason)
    if dg:
        await post(m, "GST_COLLECTED", dg, d, investor_ids=sale["investor_ids"], refs=refs, remarks=note, reason=reason)


async def _transfer_delta(m, t, delta, reason):
    k = t["kind"]
    if t["status"] not in ("initiated", "verified"):
        raise HTTPException(409, f"A {t['status']} transfer cannot be changed")
    st = await db.settlements.find_one_and_update(
        {"id": t["settlement_id"], "$expr": {"$lte": [{"$add": [f"${k}_committed", delta]}, f"${k}_recoverable"]}},
        {"$inc": {f"{k}_committed": delta, **({f"{k}_paid": delta} if t["status"] == "verified" else {})}})
    if not st:
        raise HTTPException(400, f"New amount exceeds the {k} recoverable from actual collections")
    if t["status"] == "verified":
        await db.investors.update_one({"id": t["investor_id"]}, {"$inc": {"repaid" if k == "principal" else "margin_paid": delta}})
        await post(m, "PRINCIPAL_REPAYMENT" if k == "principal" else "INVESTOR_MARGIN_PAID", delta, t["date"], investor_id=t["investor_id"],
                   refs={"sale_id": t["sale_id"], "settlement_id": t["settlement_id"], "transfer_id": t["id"]},
                   remarks=f"Correction {t['transfer_no']}: {reason}", reason=reason)


async def _capital_delta(m, inv_doc, delta, reason):
    q = {"id": inv_doc["investor_id"]}
    if delta < 0:
        q["$expr"] = {"$gte": [{"$subtract": ["$invested", "$allocated"]}, -delta]}
    if not await db.investors.find_one_and_update(q, {"$inc": {"invested": delta}}):
        raise HTTPException(400, "Capital already deployed in rolls; not enough available funds to reduce it")
    await post(m, "CAPITAL_RECEIVED", delta, inv_doc["date"], investor_id=inv_doc["investor_id"], refs={"investment_id": inv_doc["id"]},
               remarks=f"Correction {inv_doc['ref_no']}: {reason}", reason=reason)


async def _purchase_money(m, p, money, gst_pct, reason):
    rolls = await db.rolls.find({"purchase_id": p["id"], **NV}, {"_id": 0}).to_list(1000)
    n = len(rolls)
    unit, other = money.get("unit_cost", p["unit_cost"]), money.get("other_charges", p["other_charges"])
    gpct = p["gst_pct"] if gst_pct is None else gst_pct
    subtotal = unit * p["qty"]
    gst = bp_of(subtotal, to_bp(gpct))
    total = subtotal + gst + other
    paid = money.get("amount_paid", p["amount_paid"])
    if unit <= 0 or paid < 0 or paid > total:
        raise HTTPException(400, "Supplier paid amount must be between ₹0 and the procurement total, and cost must be positive")
    note = f"Correction {p['po_number']}: {reason}"
    upd = {"unit_cost": unit, "other_charges": other, "gst_pct": gpct, "gst": gst, "subtotal": subtotal, "total": total, "amount_paid": paid,
           "payment_status": "paid" if paid >= total else ("partial" if paid else "unpaid")}
    base = (subtotal + other) // p["qty"]
    if base != p["base_price"]:
        if base <= 0:
            raise HTTPException(400, "Base price must be positive")
        if any(r.get("sale_id") for r in rolls):
            raise HTTPException(409, "Some rolls of this purchase are reserved or sold; the purchase value can no longer change")
        new_fund, rem = [], base
        for i, f in enumerate(p["funding"]):
            amt = rem if i == len(p["funding"]) - 1 else bp_of(base, f["pct_bp"])
            rem -= amt
            new_fund.append({**f, "principal": amt})
        done = []
        for old, new in zip(p["funding"], new_fund):
            d = (new["principal"] - old["principal"]) * n
            q = {"id": old["investor_id"]}
            if d > 0:
                q["$expr"] = {"$gte": [{"$subtract": ["$invested", "$allocated"]}, d]}
            if not await db.investors.find_one_and_update(q, {"$inc": {"allocated": d}}):
                for iid, dd in done:
                    await db.investors.update_one({"id": iid}, {"$inc": {"allocated": -dd}})
                raise HTTPException(400, f"Insufficient available funds for {old['investor_name']}")
            done.append((old["investor_id"], d))
        for iid, d in done:
            if d:
                await post(m, "FUNDS_ALLOCATED", d, p["purchase_date"], investor_id=iid, refs={"purchase_id": p["id"]}, remarks=note, reason=reason)
        await db.rolls.update_many({"purchase_id": p["id"], **NV}, {"$set": {"base_price": base, "funding": new_fund}})
        upd.update({"base_price": base, "funding": new_fund, "principal_allocated": base * n})
    if total != p["total"]:
        await post(m, "INVENTORY_PURCHASE", total - p["total"], p["purchase_date"], investor_ids=p["investor_ids"], refs={"purchase_id": p["id"]}, remarks=note, reason=reason)
    if paid != p["amount_paid"]:
        await post(m, "SUPPLIER_PAYMENT", paid - p["amount_paid"], p["purchase_date"], investor_ids=p["investor_ids"], refs={"purchase_id": p["id"]}, remarks=note, reason=reason)
    await db.rolls.update_many({"purchase_id": p["id"]}, {"$set": {"unit_cost": unit, "landed_cost": total // p["qty"]}})
    await db.purchases.update_one({"id": p["id"]}, {"$set": upd})


# ---------- Public: edit ----------
async def edit_record(m, entity, rid, fields, reason):
    if entity not in DESC:
        raise HTTPException(404, "Unknown record type")
    reason = _reason(reason)
    doc = await get_or_404(entity, {"id": rid, **NV}, "Record not found")
    allowed = set(DESC[entity]) | set(MONEY.get(entity, [])) | ({"gst_pct"} if entity == "purchases" else set())
    if set(fields) - allowed:
        raise HTTPException(400, f"Not editable: {', '.join(sorted(set(fields) - allowed))}")
    desc = {k: str(v).strip() for k, v in fields.items() if k in DESC[entity] and str(v).strip() != str(doc.get(k) or "")}
    money = {k: to_paise(v) for k, v in fields.items() if k in MONEY.get(entity, []) and v not in (None, "") and to_paise(v) != doc.get(k)}
    gst_pct = None
    if "gst_pct" in fields:
        try:
            g = float(fields["gst_pct"])
        except (TypeError, ValueError):
            raise HTTPException(400, "Invalid GST %")
        if not 0 <= g <= 100:
            raise HTTPException(400, "GST % must be between 0 and 100")
        gst_pct = g if g != float(doc.get("gst_pct", 0)) else None
    if not desc and not money and gst_pct is None:
        raise HTTPException(400, "Nothing changed")
    blank = [k for k, v in desc.items() if not v and k in ("name", "email", "date", "purchase_date", "bank_ref", "reference", "roll_id", "customer_name", "supplier", "supplier_invoice", "brand", "po_number")]
    if blank:
        raise HTTPException(400, f"Cannot be blank: {', '.join(blank)}")
    if entity == "investors" and "email" in desc:
        desc["email"] = desc["email"].lower()
        if await db.investors.find_one({"email": desc["email"], "id": {"$ne": rid}}):
            raise HTTPException(409, "Another investor uses this email")
    if entity == "rolls" and "roll_id" in desc and await db.rolls.find_one({"roll_id": desc["roll_id"]}):
        raise HTTPException(409, "Roll ID already exists")
    if entity == "sales" and "invoice_no" in desc and doc["status"] == "reserved":
        raise HTTPException(400, "Issue the invoice first")

    if entity == "investments" and "amount" in money:
        if money["amount"] <= 0:
            raise HTTPException(400, "Amount must be positive")
        await _capital_delta(m, doc, money["amount"] - doc["amount"], reason)
    elif entity == "collections" and "amount" in money:
        if money["amount"] <= 0:
            raise HTTPException(400, "Amount must be positive; use delete to remove the payment")
        sale = await get_or_404("sales", {"id": doc["sale_id"]})
        await _apply_collection_delta(m, sale, doc, money["amount"] - doc["amount"], reason)
    elif entity == "transfers" and "amount" in money:
        if money["amount"] <= 0:
            raise HTTPException(400, "Amount must be positive")
        await _transfer_delta(m, doc, money["amount"] - doc["amount"], reason)
    elif entity == "purchases" and (money or gst_pct is not None):
        await _purchase_money(m, doc, money, gst_pct, reason)

    simple = {k: v for k, v in money.items() if entity != "purchases"}
    if desc or simple:
        await db[entity].update_one({"id": rid}, {"$set": {**desc, **simple}})
    if entity == "purchases" and any(k in desc for k in ROLL_PROPAGATE):
        await db.rolls.update_many({"purchase_id": rid}, {"$set": {k: desc[k] for k in ROLL_PROPAGATE if k in desc}})
    if entity == "rolls" and "roll_id" in desc:
        await db.sales.update_many({"roll_ref": rid}, {"$set": {"roll_serial": desc["roll_id"]}})
        await db.settlements.update_many({"roll_serial": doc["roll_id"]}, {"$set": {"roll_serial": desc["roll_id"]}})
    if entity == "sales":
        sync = {k: desc[k] for k in ("customer_name",) if k in desc}
        if sync:
            await db.settlements.update_many({"sale_id": rid}, {"$set": sync})
    if entity == "investors" and "name" in desc:
        await db.investments.update_many({"investor_id": rid}, {"$set": {"investor_name": desc["name"]}})
        await db.settlements.update_many({"investor_id": rid}, {"$set": {"investor_name": desc["name"]}})
    changes = {k: [doc.get(k), v] for k, v in {**desc, **money}.items()}
    for field, (ref, types) in DATE_LEDGER.get(entity, {}).items():
        if field in desc:
            q = {f"refs.{ref}": rid, **({"type": {"$in": types}} if types else {})}
            await db.ledger.update_many(q, {"$set": {"date": desc[field], "date_corrected_from": doc.get(field), "date_correction_reason": reason}})
    if gst_pct is not None:
        changes["gst_pct"] = [doc.get("gst_pct"), gst_pct]
    await audit(m, "RECORD_EDITED", entity, rid, {"changes": changes, "reason": reason})
    return {"ok": True, "changes": changes}


# ---------- Public: void / delete ----------
async def remove_record(m, entity, rid, mode, reason):
    if entity not in REMOVABLE:
        raise HTTPException(400, "This record type cannot be removed")
    if mode not in ("void", "delete"):
        raise HTTPException(400, "Mode must be void or delete")
    reason = _reason(reason)
    doc = await get_or_404(entity, {"id": rid, **NV}, "Record not found")
    note = f"{'Void' if mode == 'void' else 'Delete'}: {reason}"

    if entity == "investors":
        if any(doc.get(k) for k in BAL_KEYS) or await db.rolls.find_one({"investor_ids": rid, **NV}) or await db.investments.find_one({"investor_id": rid, **NV}):
            raise HTTPException(409, "This investor has investments or funded rolls. Remove those first.")
    elif entity == "investments":
        await _capital_delta(m, doc, -doc["amount"], note)
    elif entity == "collections":
        sale = await get_or_404("sales", {"id": doc["sale_id"]})
        await _apply_collection_delta(m, sale, doc, -doc["amount"], note)
    elif entity == "transfers":
        if doc["status"] in ("initiated", "verified"):
            await _transfer_delta(m, doc, -doc["amount"], note)
    elif entity == "sales":
        if doc["collected"] > 0:
            raise HTTPException(409, "Remove the customer payments on this order first")
        if await db.transfers.find_one({"sale_id": rid, "status": {"$in": ["initiated", "verified"]}}):
            raise HTTPException(409, "Remove the investor transfers on this order first")
        if doc["status"] == "invoiced":
            refs = {"sale_id": rid, "roll_id": doc["roll_ref"]}
            await post(m, "SALE_INVOICED", -doc["pricing"]["total"], doc["invoice_date"], investor_ids=doc["investor_ids"], refs=refs, remarks=f"{doc['order_no']} {note}", reason=reason)
            await post(m, "GST_PAYABLE", -doc["pricing"]["gst"], doc["invoice_date"], investor_ids=doc["investor_ids"], refs=refs, remarks=f"{doc['order_no']} {note}", reason=reason)
        if doc.get("active"):
            await db.rolls.update_many({"id": {"$in": doc.get("roll_refs") or [doc["roll_ref"]]}, "sale_id": rid}, {"$set": {"status": "in_stock", "sale_id": None},
                                      "$push": {"status_history": {"status": "in_stock", "at": now_iso(), "by": actor(m), "reason": f"order {doc['order_no']} removed"}}})
        if mode == "delete":
            await db.settlements.delete_many({"sale_id": rid})
        else:
            await db.settlements.update_many({"sale_id": rid}, {"$set": {"active": False}})
    elif entity == "purchases":
        rolls = await db.rolls.find({"purchase_id": rid, **NV}, {"_id": 0}).to_list(1000)
        if any(r.get("sale_id") for r in rolls):
            raise HTTPException(409, "Some rolls of this purchase are reserved or sold. Remove those orders first.")
        release = {}
        for r in rolls:
            for f in r["funding"]:
                release[f["investor_id"]] = release.get(f["investor_id"], 0) + f["principal"]
        for iid, amt in release.items():
            await db.investors.update_one({"id": iid}, {"$inc": {"allocated": -amt}})
            await post(m, "FUNDS_ALLOCATED", -amt, doc["purchase_date"], investor_id=iid, refs={"purchase_id": rid}, remarks=f"{doc['po_number']} {note}", reason=reason)
        await post(m, "INVENTORY_PURCHASE", -doc["total"], doc["purchase_date"], investor_ids=doc["investor_ids"], refs={"purchase_id": rid}, remarks=f"{doc['po_number']} {note}", reason=reason)
        if doc["amount_paid"]:
            await post(m, "SUPPLIER_PAYMENT", -doc["amount_paid"], doc["purchase_date"], investor_ids=doc["investor_ids"], refs={"purchase_id": rid}, remarks=f"{doc['po_number']} {note}", reason=reason)
        if mode == "delete":
            await db.rolls.delete_many({"purchase_id": rid})
        else:
            await db.rolls.update_many({"purchase_id": rid}, {"$set": {"voided": True, "status": "voided"}})

    if mode == "delete":
        await db[entity].delete_one({"id": rid})
    else:
        extra = {"status": "voided"} if entity in ("sales", "transfers") else {}
        await db[entity].update_one({"id": rid}, {"$set": {"voided": True, "void_reason": reason, "voided_by": actor(m), "voided_at": now_iso(),
                                                           "active": False if entity == "sales" else doc.get("active"), **extra}})
    await audit(m, "RECORD_DELETED" if mode == "delete" else "RECORD_VOIDED", entity, rid, {"reason": reason}, before=doc)
    return {"ok": True}
