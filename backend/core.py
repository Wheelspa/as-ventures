import os
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import requests
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

try:
    from backend.clerk_auth import require_user
except ModuleNotFoundError:
    from clerk_auth import require_user

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
IST = timezone(timedelta(hours=5, minutes=30))
AFTER = ReturnDocument.AFTER


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def today_ist():
    return datetime.now(IST).date().isoformat()


def add_days(d: str, n: int) -> str:
    return (datetime.fromisoformat(d) + timedelta(days=n)).date().isoformat()


def new_id():
    return str(uuid.uuid4())


def to_paise(rupees) -> int:
    try:
        d = Decimal(str(rupees))
    except Exception:
        raise HTTPException(400, "Invalid amount")
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_bp(pct) -> int:
    return int((Decimal(str(pct)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def bp_of(amount: int, bp: int) -> int:
    return int((Decimal(amount) * Decimal(bp) / Decimal(10000)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def inr(p) -> str:
    p = int(p or 0)
    neg, p = p < 0, abs(p)
    r, ps = divmod(p, 100)
    s = str(r)
    if len(s) > 3:
        head, tail, parts = s[:-3], s[-3:], []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{'-' if neg else ''}{s}.{ps:02d}"


async def next_seq(name, prefix, width=5):
    r = await db.counters.find_one_and_update({"_id": name}, {"$inc": {"v": 1}}, upsert=True, return_document=AFTER)
    return f"{prefix}{r['v']:0{width}d}"


def clean(doc):
    if doc:
        doc.pop("_id", None)
    return doc


# ---------- Roles & access ----------
ROLES = ["admin", "management", "accounts", "investor", "pending"]
ROLE_LABELS = {"admin": "Super Admin", "management": "Wheelspa Management", "accounts": "Wheelspa Accounts",
               "investor": "Investor", "pending": "Pending Approval"}
DEFAULT_ROLE = "pending"
RETIRED_ROLES = {}
RANK = {r: len(ROLES) - i for i, r in enumerate(ROLES)}
ENV = "live" if os.environ.get("CLERK_PUBLISHABLE_KEY", "").startswith("pk_live_") else "preview"
IN_ENV = {"env": {"$in": [ENV, None]}}

PERMS = {
    "admin": {"*"},
    "management": {"view", "staff", "approve", "verify", "reverse", "reply", "publish", "rolls", "reports", "audit"},
    "accounts": {"view", "staff", "record", "transfer", "reply", "reports", "propose"},
    "investor": {"view", "ack", "query", "reports"},
    "pending": set(),
}


def effective_role(role) -> str:
    role = RETIRED_ROLES.get(role, role)
    return role if role in ROLES else DEFAULT_ROLE


def can(m, perm) -> bool:
    p = PERMS.get(m["role"], set())
    return "*" in p or perm in p


def _clerk_profile(user_id: str):
    r = requests.get(f"https://api.clerk.com/v1/users/{user_id}", timeout=10,
                     headers={"Authorization": f"Bearer {os.environ['CLERK_SECRET_KEY']}", "User-Agent": "emergent-app"})
    r.raise_for_status()
    j = r.json()
    emails = [e["email_address"].lower() for e in j["email_addresses"]
              if (e.get("verification") or {}).get("status") == "verified"]
    name = " ".join(x for x in [j.get("first_name"), j.get("last_name")] if x) or (emails[0] if emails else "")
    return emails, name


async def current_member(request: Request) -> dict:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        raise HTTPException(401, "Not signed in")
    from auth import decode_token
    uid = decode_token(h[7:])
    m = await db.users.find_one({"user_id": uid}, {"_id": 0, "password_hash": 0})
    if not m or m.get("disabled"):
        raise HTTPException(401, "Account not found or disabled")
    role = effective_role(m.get("role"))
    if role == "investor" and not m.get("investor_id"):
        raise HTTPException(403, "Your login is not linked to an investor account yet")
    return {**m, "role": role, "env": ENV, "name": m.get("name") or m.get("email")}


def require(perm: str):
    async def check(m: dict = Depends(current_member)) -> dict:
        if not can(m, perm):
            raise HTTPException(403, "Not allowed")
        return m
    return check


def scope(m) -> dict:
    if can(m, "staff"):
        return {}
    return {"investor_ids": m.get("investor_id") or "__none__"}


def actor(m):
    return m.get("name") or m.get("email") or m["user_id"]


# ---------- Audit, notifications, ledger ----------
async def audit(m, action, entity, entity_id, details=None, before=None):
    await db.audit.insert_one({
        "id": await next_seq("audit", "AUD-", 6), "ts": now_iso(), "user_id": m["user_id"], "user": actor(m),
        "role": m["role"], "action": action, "entity": entity, "entity_id": entity_id,
        "before": before, "details": details})


async def notify(audience, type_, title, message, link=""):
    await db.notifications.insert_one({"id": new_id(), "audience": audience, "type": type_, "title": title,
                                       "message": message, "link": link, "created_at": now_iso(), "read_by": []})


async def notify_all(investor_ids, type_, title, message, link=""):
    await notify("staff", type_, title, message, link)
    for i in set(investor_ids or []):
        await notify(i, type_, title, message, link)


LEDGER_TYPES = {
    "CAPITAL_RECEIVED": "Investor capital received",
    "FUNDS_ALLOCATED": "Funds allocated for procurement",
    "INVENTORY_PURCHASE": "PPF inventory purchase",
    "SUPPLIER_PAYMENT": "Supplier payment",
    "SALE_INVOICED": "Customer sale invoiced",
    "GST_PAYABLE": "GST payable on sale",
    "CUSTOMER_PAYMENT": "Customer payment received",
    "GST_COLLECTED": "GST collected",
    "PRINCIPAL_RECOVERED": "Principal recovered (collected)",
    "INVESTOR_MARGIN_EARNED": "Investor margin earned / payable",
    "WHEELSPA_MARGIN": "Wheelspa margin earned",
    "INCOME_TAX": "Income tax on margin (provision)",
    "PRINCIPAL_REPAYMENT": "Principal repaid to investor",
    "INVESTOR_MARGIN_PAID": "Investor margin paid",
    "REFUND": "Refund / return",
    "ADJUSTMENT": "Adjustment",
    "BANK_CHARGE": "Bank charges",
    "EXPENSE": "Approved expense",
}
REVERSIBLE = {"CAPITAL_RECEIVED", "SUPPLIER_PAYMENT", "ADJUSTMENT", "BANK_CHARGE", "EXPENSE", "REFUND"}


async def post(m, type_, amount, date, investor_id=None, investor_ids=None, refs=None, remarks="",
               doc_ids=None, reversal_of=None, reason=None):
    ids = investor_ids if investor_ids is not None else ([investor_id] if investor_id else [])
    e = {"txn_id": await next_seq("txn", "TXN-", 6), "type": type_, "amount": int(amount), "date": date,
         "investor_id": investor_id, "investor_ids": ids, "refs": refs or {}, "remarks": remarks,
         "doc_ids": [d for d in (doc_ids or []) if d], "reversal_of": reversal_of, "reason": reason,
         "created_at": now_iso(), "created_by": actor(m), "created_by_id": m["user_id"]}
    await db.ledger.insert_one(e)
    return clean(e)


async def link_docs(doc_ids, investor_ids):
    ids = [d for d in (doc_ids or []) if d]
    if ids and investor_ids:
        await db.documents.update_many({"id": {"$in": ids}}, {"$addToSet": {"investor_ids": {"$each": list(investor_ids)}}})
