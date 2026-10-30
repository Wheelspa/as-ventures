import re
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr
from starlette.concurrency import run_in_threadpool

from storage import save_document, get_object
from core import (db, ROLES, ROLE_LABELS, RANK, IN_ENV, PERMS, LEDGER_TYPES, REVERSIBLE, effective_role,
                  current_member, require, scope, can, actor, new_id, now_iso, to_paise, audit, notify, notify_all,
                  post, link_docs, next_seq, clean)
import finance as F
import reports as R
import corrections as C

api = APIRouter(prefix="/api")
view = require("view")


class InvestorIn(BaseModel):
    name: str
    email: EmailStr
    phone: str = ""
    pan: str = ""
    bank_details: str = ""


class AgreementIn(BaseModel):
    default_base_price: Optional[float] = None
    margin_pct: float = 30
    income_tax_pct: float = 30
    investor_share_pct: float = 50
    gst_pct: float = 18
    gst_mode: str = "full_value"
    settlement_days: int = 7
    effective_from: date
    notes: str = ""


class InvestmentIn(BaseModel):
    investor_id: str
    amount: float
    date: date
    bank_ref: str
    doc_id: Optional[str] = None
    terms_note: str = ""


class FundingIn(BaseModel):
    investor_id: str
    pct: float


class PurchaseIn(BaseModel):
    supplier: str
    supplier_invoice: str
    purchase_date: date
    brand: str
    series: str = ""
    thickness: str = ""
    specs: str = ""
    qty: int
    unit_cost: float
    gst_pct: float = 18
    other_charges: float = 0
    base_price: Optional[float] = None
    amount_paid: float = 0
    funding: List[FundingIn]
    batch_no: str = ""
    po_number: str = ""
    invoice_doc_id: Optional[str] = None
    payment_doc_id: Optional[str] = None


class PurchaseItemIn(BaseModel):
    brand: str
    series: str = ""
    thickness: str = ""
    specs: str = ""
    qty: int
    unit_cost: float
    gst_pct: float = 18


class PurchaseInvoiceIn(BaseModel):
    supplier: str
    supplier_invoice: str
    purchase_date: date
    items: List[PurchaseItemIn]
    other_charges: float = 0
    amount_paid: float = 0
    funding: List[FundingIn]
    invoice_doc_id: Optional[str] = None
    payment_doc_id: Optional[str] = None


class PaymentIn(BaseModel):
    amount: float
    date: date
    reference: str = ""
    doc_id: Optional[str] = None


class SaleIn(BaseModel):
    customer_name: str
    customer_code: str = ""
    vehicle: str = ""
    purchase_id: str
    qty: int
    sale_date: date
    margin_pct: Optional[float] = None
    invoice_no: str = ""
    amount_received: Optional[float] = None
    payment_reference: str = ""
    payment_mode: str = "Bank transfer"
    remarks: str = ""


class InvoiceIn(BaseModel):
    invoice_no: str = ""
    invoice_date: Optional[date] = None
    doc_id: Optional[str] = None


class CollectionIn(BaseModel):
    amount: float
    date: date
    mode: str = "Bank transfer"
    reference: str
    doc_id: Optional[str] = None


class TransferIn(BaseModel):
    kind: str
    amount: float
    date: date
    bank_ref: str
    doc_id: Optional[str] = None


class ReasonIn(BaseModel):
    reason: str


class NoteIn(BaseModel):
    note: str = ""


class QueryIn(BaseModel):
    subject: str
    message: str
    sale_id: Optional[str] = None
    settlement_id: Optional[str] = None
    doc_id: Optional[str] = None


class ReplyIn(BaseModel):
    message: str
    doc_id: Optional[str] = None


class AdjustIn(BaseModel):
    type: str
    amount: float
    date: date
    reason: str
    investor_id: Optional[str] = None
    doc_id: Optional[str] = None


class RollStatusIn(BaseModel):
    status: str
    reason: str


class RoleIn(BaseModel):
    role: str
    investor_id: Optional[str] = None


class InviteIn(BaseModel):
    email: EmailStr
    role: str
    investor_id: Optional[str] = None


class PublishIn(BaseModel):
    investor_id: str
    month: str


class EditIn(BaseModel):
    fields: dict
    reason: str


class RemoveIn(BaseModel):
    mode: str
    reason: str


@api.patch("/admin/{entity}/{rid}")
async def admin_edit(entity: str, rid: str, body: EditIn, m: dict = Depends(require("edit"))):
    return await C.edit_record(m, entity, rid, body.fields, body.reason)


@api.post("/admin/{entity}/{rid}/remove")
async def admin_remove(entity: str, rid: str, body: RemoveIn, m: dict = Depends(require("edit"))):
    return await C.remove_record(m, entity, rid, body.mode, body.reason)


class PreviewIn(BaseModel):
    purchase_id: str
    qty: int = 1
    sale_date: date
    margin_pct: Optional[float] = None


def js(model):
    return model.model_dump(mode="json")


def need_reason(r: str):
    if not r or len(r.strip()) < 3:
        raise HTTPException(400, "A reason is required")
    return r.strip()


async def scoped_one(coll, m, id_, msg="Not found"):
    return await F.get_or_404(coll, {"id": id_, **scope(m)}, msg)


def text_q(q, fields):
    if not q:
        return {}
    rx = {"$regex": re.escape(q), "$options": "i"}
    return {"$or": [{f: rx} for f in fields]}


# ---------- Me / users ----------
@api.get("/me")
async def me(m: dict = Depends(current_member)):
    perms = sorted(PERMS.get(m["role"], set()))
    inv = await db.investors.find_one({"id": m.get("investor_id")}, {"_id": 0, "name": 1, "code": 1}) if m.get("investor_id") else None
    return {**m, "role_label": ROLE_LABELS[m["role"]], "perms": perms, "investor": inv}


@api.get("/users")
async def list_users(m: dict = Depends(require("users"))):
    people = await db.users.find(IN_ENV, {"_id": 0, "password_hash": 0}).to_list(1000)
    return {"roles": [{"id": r, "label": ROLE_LABELS[r]} for r in ROLES if RANK[r] <= RANK[m["role"]]],
            "users": [{**p, "role": effective_role(p.get("role"))} for p in people]}


@api.patch("/users/{user_id}/role")
async def set_role(user_id: str, body: RoleIn, m: dict = Depends(require("users"))):
    if body.role not in ROLES or RANK[body.role] > RANK[m["role"]]:
        raise HTTPException(403, "Not allowed")
    target = await db.users.find_one({"user_id": user_id, **IN_ENV}, {"_id": 0})
    if target is None:
        raise HTTPException(404, "Not found")
    if (effective_role(target.get("role")) == "admin" and body.role != "admin"
            and await db.users.count_documents({"role": "admin", **IN_ENV}) <= 1):
        raise HTTPException(409, "Keep at least one admin")
    inv_id = None
    if body.role == "investor":
        if not body.investor_id or not await db.investors.find_one({"id": body.investor_id}):
            raise HTTPException(400, "Select the investor account to link")
        inv_id = body.investor_id
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": body.role, "investor_id": inv_id}})
    await audit(m, "ROLE_CHANGED", "user", user_id, {"role": body.role, "investor_id": inv_id}, before={"role": target.get("role")})
    return {"user_id": user_id, "role": body.role, "investor_id": inv_id}


@api.get("/invites")
async def list_invites(m: dict = Depends(require("users"))):
    return await db.invites.find({}, {"_id": 0}).to_list(500)


@api.post("/invites")
async def add_invite(body: InviteIn, m: dict = Depends(require("users"))):
    if body.role not in ROLES or body.role == "pending":
        raise HTTPException(400, "Invalid role")
    if body.role == "investor" and not (body.investor_id and await db.investors.find_one({"id": body.investor_id})):
        raise HTTPException(400, "Select the investor account to link")
    doc = {"id": new_id(), "email": body.email.lower(), "role": body.role, "investor_id": body.investor_id if body.role == "investor" else None,
           "created_by": actor(m), "created_at": now_iso()}
    await db.invites.update_one({"email": doc["email"]}, {"$set": doc}, upsert=True)
    await audit(m, "ACCESS_GRANTED", "invite", doc["email"], {"role": body.role})
    return doc


@api.delete("/invites/{invite_id}")
async def del_invite(invite_id: str, m: dict = Depends(require("users"))):
    r = await db.invites.find_one_and_delete({"id": invite_id})
    if not r:
        raise HTTPException(404, "Not found")
    await audit(m, "ACCESS_REVOKED", "invite", r["email"])
    return {"ok": True}


# ---------- Documents ----------
ALLOWED = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".xlsx", ".xls", ".csv"}


@api.post("/documents")
async def upload(file: UploadFile = File(...), m: dict = Depends(view)):
    ext = ("." + file.filename.rsplit(".", 1)[-1].lower()) if "." in file.filename else ""
    if ext not in ALLOWED:
        raise HTTPException(400, "Allowed: PDF, images, Excel, CSV")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(400, "Max file size is 10 MB")
    doc = await save_document(m, file.filename, data, file.content_type or "application/octet-stream")
    await audit(m, "DOCUMENT_UPLOADED", "document", doc["id"], {"filename": file.filename})
    return doc


@api.get("/documents/{doc_id}")
async def download(doc_id: str, m: dict = Depends(view)):
    q = {"id": doc_id}
    if not can(m, "staff"):
        q["$or"] = [{"investor_ids": m.get("investor_id") or "__none__"}, {"uploaded_by_id": m["user_id"]}]
    d = await F.get_or_404("documents", {**q, "is_deleted": False}, "Document not found")
    data, ctype = await run_in_threadpool(get_object, d["storage_path"])
    return Response(data, media_type=d.get("content_type") or ctype,
                     headers={"Content-Disposition": f'inline; filename="{d["filename"]}"'})


@api.get("/documents")
async def doc_meta(ids: str, m: dict = Depends(view)):
    q = {"id": {"$in": ids.split(",")}}
    if not can(m, "staff"):
        q["$or"] = [{"investor_ids": m.get("investor_id") or "__none__"}, {"uploaded_by_id": m["user_id"]}]
    return await db.documents.find(q, {"_id": 0, "storage_path": 0}).to_list(100)


# ---------- Investors & terms ----------
@api.get("/investors")
async def investors(m: dict = Depends(view)):
    q = {} if can(m, "staff") else {"id": m.get("investor_id") or "__none__"}
    rows = await db.investors.find({**q, "voided": {"$ne": True}}, {"_id": 0}).sort("code", 1).to_list(500)
    return [{**r, "balances": F.balances(r)} for r in rows]


@api.post("/investors")
async def add_investor(body: InvestorIn, m: dict = Depends(require("users"))):
    return await F.create_investor(m, js(body))


@api.get("/investors/{iid}")
async def investor_detail(iid: str, m: dict = Depends(view)):
    if not can(m, "staff") and m.get("investor_id") != iid:
        raise HTTPException(404, "Investor not found")
    inv = await F.get_or_404("investors", {"id": iid}, "Investor not found")
    ags = await db.agreements.find({"investor_id": iid}, {"_id": 0}).sort("version", -1).to_list(100)
    invs = await db.investments.find({"investor_id": iid, "voided": {"$ne": True}}, {"_id": 0}).sort("date", -1).to_list(500)
    counts = {}
    async for r in db.rolls.find({"investor_ids": iid, "voided": {"$ne": True}}, {"status": 1}):
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {**inv, "balances": F.balances(inv), "agreements": ags, "investments": invs, "roll_counts": counts}


@api.get("/investors/{iid}/avg-cost")
async def avg_cost(iid: str, m: dict = Depends(require("staff"))):
    return {"avg": await F.avg_roll_cost(iid)}


@api.post("/investors/{iid}/agreements")
async def add_agreement(iid: str, body: AgreementIn, m: dict = Depends(require("propose"))):
    return await F.propose_agreement(m, iid, js(body))


@api.post("/agreements/{aid}/approve")
async def approve_agreement(aid: str, m: dict = Depends(require("approve"))):
    return await F.decide_agreement(m, aid, True)


@api.post("/agreements/{aid}/reject")
async def reject_agreement(aid: str, body: ReasonIn, m: dict = Depends(require("approve"))):
    return await F.decide_agreement(m, aid, False, need_reason(body.reason))


@api.get("/investments")
async def investments(m: dict = Depends(view)):
    return await db.investments.find({**scope(m), "voided": {"$ne": True}}, {"_id": 0}).sort("date", -1).to_list(1000)


@api.post("/investments")
async def add_investment(body: InvestmentIn, m: dict = Depends(require("record"))):
    return await F.record_investment(m, js(body))


# ---------- Procurement & inventory ----------
@api.get("/purchases")
async def purchases(m: dict = Depends(view)):
    return await db.purchases.find({**scope(m), "voided": {"$ne": True}}, {"_id": 0}).sort("purchase_date", -1).to_list(1000)


@api.post("/purchases")
async def add_purchase(body: PurchaseInvoiceIn, m: dict = Depends(require("record"))):
    return await F.create_purchase_invoice(m, js(body))


@api.post("/purchases/{pid}/payments")
async def supplier_payment(pid: str, body: PaymentIn, m: dict = Depends(require("record"))):
    return await F.record_supplier_payment(m, pid, js(body))


@api.get("/rolls")
async def rolls(status: Optional[str] = None, q: Optional[str] = None, investor_id: Optional[str] = None,
                purchase_id: Optional[str] = None, m: dict = Depends(view)):
    f = {**scope(m), **text_q(q, ["roll_id", "batch_no", "brand", "series", "po_number"])}
    if status:
        f["status"] = {"$in": status.split(",")}
    if investor_id and can(m, "staff"):
        f["investor_ids"] = investor_id
    if purchase_id:
        f["purchase_id"] = purchase_id
    f["voided"] = {"$ne": True}
    return await db.rolls.find(f, {"_id": 0, "status_history": 0}).sort("roll_id", 1).to_list(2000)


@api.get("/rolls/{rid}/trace")
async def roll_trace(rid: str, m: dict = Depends(view)):
    roll = await F.get_or_404("rolls", {"$or": [{"id": rid}, {"roll_id": rid}], **scope(m)}, "Roll not found")
    purchase = await db.purchases.find_one({"id": roll["purchase_id"]}, {"_id": 0})
    sales = await db.sales.find({"$or": [{"roll_ref": roll["id"]}, {"roll_refs": roll["id"]}]}, {"_id": 0}).to_list(20)
    sids = [s["id"] for s in sales]
    sts = [await F.enrich_settlement(s) for s in await db.settlements.find({"sale_id": {"$in": sids}, **scope(m)}, {"_id": 0}).to_list(50)]
    trs = await db.transfers.find({"sale_id": {"$in": sids}, **scope(m)}, {"_id": 0}).to_list(100)
    led = await db.ledger.find({"$or": [{"refs.roll_id": roll["id"]}, {"refs.purchase_id": roll["purchase_id"], "type": {"$in": ["INVENTORY_PURCHASE", "FUNDS_ALLOCATED"]}},
                                        {"refs.sale_id": {"$in": sids}}], **scope(m)}, {"_id": 0}).sort("txn_id", 1).to_list(200)
    return {"roll": roll, "purchase": purchase, "sales": sales, "settlements": sts, "transfers": trs, "ledger": led}


@api.patch("/rolls/{rid}/status")
async def roll_status(rid: str, body: RollStatusIn, m: dict = Depends(require("rolls"))):
    if body.status not in ("in_stock", "damaged", "returned", "disputed"):
        raise HTTPException(400, "Invalid status")
    reason = need_reason(body.reason)
    allowed_from = ["damaged", "returned", "disputed"] if body.status == "in_stock" else ["in_stock"]
    r = await db.rolls.find_one_and_update({"id": rid, "status": {"$in": allowed_from}},
                                           {"$set": {"status": body.status}, "$push": {"status_history": {"status": body.status, "at": now_iso(), "by": actor(m), "reason": reason}}},
                                           projection={"_id": 0})
    if not r:
        raise HTTPException(409, "Status change not allowed for this roll")
    await audit(m, "ROLL_STATUS_CHANGED", "roll", rid, {"to": body.status, "reason": reason}, before={"status": r["status"]})
    if body.status != "in_stock":
        await notify_all(r["investor_ids"], "inventory", "Roll flagged", f"{r['roll_id']} marked {body.status}: {reason}", f"/rolls/{rid}")
    return {"ok": True}


# ---------- Sales ----------
@api.post("/pricing/preview")
async def preview(body: PreviewIn, m: dict = Depends(require("staff"))):
    if body.qty < 1:
        raise HTTPException(400, "Quantity must be at least 1")
    _, pricing = await F.price_batch(body.purchase_id, body.qty, body.sale_date.isoformat(), body.margin_pct)
    return {"pricing": pricing}


@api.get("/inventory/batches")
async def inventory_batches(q: Optional[str] = None, investor_id: Optional[str] = None, m: dict = Depends(view)):
    f = {**scope(m), **text_q(q, ["batch_no", "brand", "series", "po_number"]), "voided": {"$ne": True}}
    if investor_id and can(m, "staff"):
        f["investor_ids"] = investor_id
    st = lambda s: {"$sum": {"$cond": [{"$eq": ["$status", s]}, 1, 0]}}
    rows = await db.rolls.aggregate([
        {"$match": f},
        {"$group": {"_id": "$purchase_id", "total": {"$sum": 1}, "in_stock": st("in_stock"), "sold": st("sold"),
                    "reserved": st("reserved"), **{k: {"$first": f"${k}"} for k in
                    ("batch_no", "po_number", "brand", "series", "thickness", "specs", "base_price", "landed_cost", "purchase_date", "funding")}}},
        {"$sort": {"purchase_date": -1, "po_number": -1}}]).to_list(1000)
    out = []
    for r in rows:
        r["other"] = r["total"] - r["in_stock"] - r["sold"] - r["reserved"]
        r["stock_value"] = r["in_stock"] * r["base_price"]
        if not can(m, "staff"):
            r.pop("landed_cost", None)
        out.append({"purchase_id": r.pop("_id"), **r})
    return out


@api.get("/stock/batches")
async def stock_batches(m: dict = Depends(require("staff"))):
    rows = await db.rolls.aggregate([
        {"$match": {"status": "in_stock", "voided": {"$ne": True}}},
        {"$group": {"_id": "$purchase_id", "available": {"$sum": 1}, **{k: {"$first": f"${k}"} for k in
                    ("batch_no", "po_number", "brand", "series", "thickness", "base_price", "purchase_date")}}},
        {"$sort": {"purchase_date": 1}}]).to_list(1000)
    return [{"purchase_id": r.pop("_id"), **r} for r in rows]


@api.get("/sales")
async def sales(status: Optional[str] = None, q: Optional[str] = None, date_from: Optional[str] = None,
                date_to: Optional[str] = None, m: dict = Depends(view)):
    f = {**scope(m), **text_q(q, ["order_no", "customer_name", "customer_code", "roll_serial", "invoice_no"]), "voided": {"$ne": True}}
    if status:
        f["status"] = {"$in": status.split(",")}
    if date_from or date_to:
        f["order_date"] = R.rng(date_from, date_to)
    return await db.sales.find(f, {"_id": 0}).sort("order_no", -1).to_list(2000)


@api.get("/sales/{sid}")
async def sale_detail(sid: str, m: dict = Depends(view)):
    s = await scoped_one("sales", m, sid, "Sale not found")
    sq = {"sale_id": sid, **scope(m)}
    sts = [await F.enrich_settlement(x) for x in await db.settlements.find(sq, {"_id": 0}).to_list(20)]
    if not can(m, "staff"):
        s["pricing"]["lines"] = [ln for ln in s["pricing"]["lines"] if ln["investor_id"] == m.get("investor_id")]
    return {"sale": s, "settlements": sts,
            "collections": await db.collections.find({"sale_id": sid, "voided": {"$ne": True}}, {"_id": 0}).sort("date", 1).to_list(100),
            "transfers": await db.transfers.find({**sq, "voided": {"$ne": True}}, {"_id": 0}).sort("created_at", 1).to_list(100),
            "queries": await db.queries.find(sq, {"_id": 0}).sort("created_at", -1).to_list(50),
            "ledger": await db.ledger.find({"refs.sale_id": sid, **scope(m)}, {"_id": 0}).sort("txn_id", 1).to_list(200)}


@api.post("/sales")
async def add_sale(body: SaleIn, m: dict = Depends(require("record"))):
    return await F.create_direct_sale(m, js(body))


@api.post("/sales/{sid}/invoice")
async def sale_invoice(sid: str, body: InvoiceIn, m: dict = Depends(require("record"))):
    return await F.invoice_sale(m, sid, js(body))


@api.post("/sales/{sid}/cancel")
async def sale_cancel(sid: str, body: ReasonIn, m: dict = Depends(require("record"))):
    return await F.cancel_sale(m, sid, need_reason(body.reason))


@api.post("/sales/{sid}/collections")
async def sale_collection(sid: str, body: CollectionIn, m: dict = Depends(require("record"))):
    return await F.record_collection(m, sid, js(body))


@api.get("/sales/{sid}/statement")
async def sale_stmt(sid: str, format: str = "pdf", m: dict = Depends(view)):
    d = await sale_detail(sid, m)
    rep = R.sale_statement(d["sale"], d["settlements"], d["transfers"])
    return export(rep, format, f"statement_{d['sale']['order_no']}")


# ---------- Settlements & transfers ----------
@api.get("/settlements")
async def settlements(status: Optional[str] = None, investor_id: Optional[str] = None, q: Optional[str] = None, m: dict = Depends(view)):
    f = {**scope(m), "active": True, **text_q(q, ["order_no", "roll_serial", "customer_name", "settlement_no"])}
    if investor_id and can(m, "staff"):
        f["investor_id"] = investor_id
    rows = [await F.enrich_settlement(s) for s in await db.settlements.find(f, {"_id": 0}).sort("order_no", -1).to_list(2000)]
    if status:
        rows = [r for r in rows if r["status"] in status.split(",")]
    return rows


@api.get("/transfers")
async def transfers(status: Optional[str] = None, m: dict = Depends(view)):
    f = {**scope(m), "voided": {"$ne": True}}
    if status:
        f["status"] = {"$in": status.split(",")}
    return await db.transfers.find(f, {"_id": 0}).sort("created_at", -1).to_list(2000)


@api.post("/settlements/{stid}/transfers")
async def add_transfer(stid: str, body: TransferIn, m: dict = Depends(require("transfer"))):
    return await F.create_transfer(m, stid, js(body))


@api.post("/transfers/{tid}/verify")
async def verify(tid: str, m: dict = Depends(require("verify"))):
    return await F.verify_transfer(m, tid)


@api.post("/transfers/{tid}/reject")
async def reject(tid: str, body: ReasonIn, m: dict = Depends(require("verify"))):
    return await F.reject_transfer(m, tid, need_reason(body.reason))


@api.post("/settlements/{stid}/ack")
async def ack(stid: str, body: NoteIn, m: dict = Depends(require("ack"))):
    return await F.acknowledge(m, stid, body.note)


# ---------- Ledger ----------
@api.get("/ledger")
async def ledger(type: Optional[str] = None, q: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                 investor_id: Optional[str] = None, m: dict = Depends(view)):
    f = {**scope(m), **text_q(q, ["txn_id", "remarks", "created_by"])}
    if type:
        f["type"] = {"$in": type.split(",")}
    if date_from or date_to:
        f["date"] = R.rng(date_from, date_to)
    if investor_id and can(m, "staff"):
        f["investor_ids"] = investor_id
    rows = await db.ledger.find(f, {"_id": 0}).sort("txn_id", -1).to_list(3000)
    reversed_ids = {r["reversal_of"] async for r in db.ledger.find({"reversal_of": {"$ne": None}}, {"reversal_of": 1})}
    for r in rows:
        r["reversed"] = r["txn_id"] in reversed_ids
        r["type_label"] = LEDGER_TYPES.get(r["type"], r["type"])
    return {"types": LEDGER_TYPES, "reversible": sorted(REVERSIBLE), "rows": rows}


@api.post("/ledger/{txn_id}/reverse")
async def reverse(txn_id: str, body: ReasonIn, m: dict = Depends(require("reverse"))):
    reason = need_reason(body.reason)
    e = await F.get_or_404("ledger", {"txn_id": txn_id}, "Entry not found")
    if e["type"] not in REVERSIBLE or e.get("reversal_of"):
        raise HTTPException(400, "This entry is posted by a workflow; correct it through the workflow (cancel / reject) instead")
    if await db.ledger.find_one({"reversal_of": txn_id}):
        raise HTTPException(409, "Entry already reversed")
    if e["type"] == "CAPITAL_RECEIVED":
        r = await db.investors.find_one_and_update({"id": e["investor_id"], "$expr": {"$gte": [{"$subtract": ["$invested", "$allocated"]}, e["amount"]]}},
                                                   {"$inc": {"invested": -e["amount"]}})
        if not r:
            raise HTTPException(400, "Capital already deployed; cannot reverse more than available funds")
        if e["refs"].get("investment_id"):
            await db.investments.update_one({"id": e["refs"]["investment_id"]}, {"$set": {"status": "reversed", "reversed_reason": reason}})
    if e["type"] == "SUPPLIER_PAYMENT" and e["refs"].get("purchase_id"):
        p = await db.purchases.find_one_and_update({"id": e["refs"]["purchase_id"]}, {"$inc": {"amount_paid": -e["amount"]}}, projection={"_id": 0}, return_document=True)
        if p:
            await db.purchases.update_one({"id": p["id"]}, {"$set": {"payment_status": "paid" if p["amount_paid"] >= p["total"] else ("partial" if p["amount_paid"] > 0 else "unpaid")}})
    rev = await post(m, e["type"], -e["amount"], e["date"], investor_id=e["investor_id"], investor_ids=e["investor_ids"], refs=e["refs"],
                     remarks=f"Reversal of {txn_id}", reversal_of=txn_id, reason=reason)
    await audit(m, "LEDGER_REVERSED", "ledger", txn_id, {"reversal": rev["txn_id"], "reason": reason}, before={"amount": e["amount"]})
    return rev


@api.post("/ledger/adjustments")
async def adjustment(body: AdjustIn, m: dict = Depends(require("reverse"))):
    if body.type not in ("ADJUSTMENT", "BANK_CHARGE", "EXPENSE", "REFUND"):
        raise HTTPException(400, "Invalid adjustment type")
    e = await post(m, body.type, to_paise(body.amount), body.date.isoformat(), investor_id=body.investor_id, refs={},
                   remarks=need_reason(body.reason), doc_ids=[body.doc_id], reason=body.reason)
    await link_docs([body.doc_id], [body.investor_id] if body.investor_id else [])
    await audit(m, "ADJUSTMENT_POSTED", "ledger", e["txn_id"], {"type": body.type, "amount": e["amount"], "reason": body.reason})
    return e


# ---------- Queries ----------
@api.get("/queries")
async def queries(status: Optional[str] = None, m: dict = Depends(view)):
    f = scope(m)
    if status:
        f["status"] = status
    return await db.queries.find(f, {"_id": 0}).sort("created_at", -1).to_list(1000)


@api.post("/queries")
async def raise_query(body: QueryIn, m: dict = Depends(require("query"))):
    sale = await scoped_one("sales", m, body.sale_id, "Order not found") if body.sale_id else None
    if body.settlement_id:
        await scoped_one("settlements", m, body.settlement_id, "Settlement not found")
    q = {"id": new_id(), "query_no": await next_seq("qry", "QRY-", 4), "investor_id": m["investor_id"], "investor_ids": [m["investor_id"]],
         "sale_id": body.sale_id, "order_no": sale["order_no"] if sale else None, "settlement_id": body.settlement_id,
         "subject": body.subject, "status": "open", "created_by": actor(m), "created_at": now_iso(),
         "messages": [{"by": actor(m), "role": m["role"], "text": body.message, "doc_id": body.doc_id, "at": now_iso()}]}
    await db.queries.insert_one(q)
    await audit(m, "QUERY_RAISED", "query", q["id"], {"subject": body.subject, "order": q["order_no"]})
    await notify("staff", "query", "Transaction query raised", f"{q['query_no']}: {body.subject}", "/queries")
    return clean(q)


@api.post("/queries/{qid}/reply")
async def reply(qid: str, body: ReplyIn, m: dict = Depends(view)):
    if not (can(m, "reply") or can(m, "query")):
        raise HTTPException(403, "Not allowed")
    q = await scoped_one("queries", m, qid, "Query not found")
    staff = can(m, "staff")
    await db.queries.update_one({"id": qid}, {"$push": {"messages": {"by": actor(m), "role": m["role"], "text": body.message, "doc_id": body.doc_id, "at": now_iso()}},
                                              "$set": {"status": "answered" if staff else "open"}})
    await link_docs([body.doc_id], q["investor_ids"])
    await audit(m, "QUERY_REPLY", "query", qid, {"text": body.message[:120]})
    if staff:
        await notify(q["investor_id"], "query", "Query answered", f"{q['query_no']}: {q['subject']}", "/queries")
    else:
        await notify("staff", "query", "Investor follow-up", f"{q['query_no']}: {q['subject']}", "/queries")
    return {"ok": True}


@api.post("/queries/{qid}/close")
async def close_query(qid: str, m: dict = Depends(view)):
    await scoped_one("queries", m, qid, "Query not found")
    await db.queries.update_one({"id": qid}, {"$set": {"status": "closed", "closed_by": actor(m), "closed_at": now_iso()}})
    await audit(m, "QUERY_CLOSED", "query", qid)
    return {"ok": True}


# ---------- Audit, notifications, dashboard, reports ----------
@api.get("/audit")
async def audit_log(q: Optional[str] = None, m: dict = Depends(require("audit"))):
    return await db.audit.find(text_q(q, ["action", "user", "entity", "entity_id", "id"]), {"_id": 0}).sort("ts", -1).to_list(2000)


@api.get("/notifications")
async def notifications(m: dict = Depends(view)):
    aud = "staff" if can(m, "staff") else (m.get("investor_id") or "__none__")
    rows = await db.notifications.find({"audience": aud}, {"_id": 0}).sort("created_at", -1).to_list(60)
    for r in rows:
        r["read"] = m["user_id"] in r.pop("read_by", [])
    return rows


@api.post("/notifications/read-all")
async def read_all(m: dict = Depends(view)):
    aud = "staff" if can(m, "staff") else (m.get("investor_id") or "__none__")
    await db.notifications.update_many({"audience": aud}, {"$addToSet": {"read_by": m["user_id"]}})
    return {"ok": True}


class EraseIn(BaseModel):
    confirm: str


BUSINESS = ["agreements", "investments", "purchases", "investors", "counters", "settlements", "documents", "sales", "rolls",
            "transfers", "collections", "ledger", "queries", "notifications", "invites", "audit"]


@api.post("/admin/erase-all")
async def erase_all(body: EraseIn, m: dict = Depends(require("edit"))):
    if body.confirm != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm")
    counts = {c: (await db[c].delete_many({})).deleted_count for c in BUSINESS}
    await db.users.update_many({"investor_id": {"$ne": None}}, {"$set": {"investor_id": None}})
    await audit(m, "ALL_DATA_ERASED", "system", "all", {"deleted": counts})
    return {"ok": True, "deleted": sum(counts.values())}


@api.get("/dashboard")
async def dashboard(m: dict = Depends(view)):
    await F.run_alerts()
    return await R.dashboard(m)


@api.get("/reconciliation")
async def reconciliation(m: dict = Depends(view)):
    return await R.reconcile(m, notify_on_fail=True)


def export(rep, fmt, name):
    if fmt == "xlsx":
        return Response(R.to_xlsx(rep), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})
    if fmt == "pdf":
        return Response(R.to_pdf(rep), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    return rep


@api.get("/reports")
async def report_list(m: dict = Depends(require("reports"))):
    return [{"key": k, "title": v} for k, v in R.REPORTS.items() if k != "audit" or can(m, "audit")]


@api.get("/reports/{key}")
async def report(key: str, date_from: Optional[str] = None, date_to: Optional[str] = None, investor_id: Optional[str] = None,
                 month: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}$"), format: str = "json", m: dict = Depends(require("reports"))):
    rep = await R.build_report(key, m, date_from, date_to, investor_id, month)
    return export(rep, format, f"{key}_{rep['period'].replace(' ', '_')}")


@api.post("/statements/publish")
async def publish(body: PublishIn, m: dict = Depends(require("publish"))):
    if not re.match(r"^\d{4}-\d{2}$", body.month):
        raise HTTPException(400, "Month must be YYYY-MM")
    inv = await F.get_or_404("investors", {"id": body.investor_id}, "Investor not found")
    doc = {"id": new_id(), "investor_id": inv["id"], "investor_ids": [inv["id"]], "investor_name": inv["name"], "month": body.month,
           "published_by": actor(m), "published_at": now_iso()}
    await db.statements.update_one({"investor_id": inv["id"], "month": body.month}, {"$set": doc}, upsert=True)
    await audit(m, "STATEMENT_PUBLISHED", "statement", doc["id"], {"investor": inv["name"], "month": body.month})
    await notify_all([inv["id"]], "statement", "Monthly statement published", f"Reconciliation statement for {body.month} is available", "/reports")
    return doc


@api.get("/statements")
async def statements(m: dict = Depends(view)):
    return await db.statements.find(scope(m), {"_id": 0}).sort("month", -1).to_list(500)
