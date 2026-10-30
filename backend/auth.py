import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from core import db, new_id, now_iso, ROLES, ROLE_LABELS, current_member, require, audit, effective_role, notify

JWT_SECRET = os.environ["JWT_SECRET"]
TOKEN_HOURS = 12
MAX_FAILS, LOCK_MIN = 5, 15
auth_router = APIRouter(prefix="/api")


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_pw(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except ValueError:
        return False


def make_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    return jwt.encode({"sub": user_id, "exp": exp}, JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> str:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])["sub"]
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired, please sign in again")


def strong(pw: str):
    if len(pw or "") < 8:
        raise HTTPException(400, "Password must be at least 8 characters")


async def seed_admin():
    email = os.environ["ADMIN_EMAIL"].split(",")[0].strip().lower()
    u = await db.users.find_one({"email": email})
    if u is None:
        await db.users.insert_one({"user_id": new_id(), "email": email, "name": "Super Admin", "role": "admin", "investor_id": None,
                                   "password_hash": hash_pw(os.environ["ADMIN_PASSWORD"]), "created_at": now_iso()})
    elif not u.get("password_hash"):
        await db.users.update_one({"email": email}, {"$set": {"role": "admin", "password_hash": hash_pw(os.environ["ADMIN_PASSWORD"])}})
    await db.users.create_index("email")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotIn(BaseModel):
    email: EmailStr


class ChangePwIn(BaseModel):
    current_password: str = ""
    new_password: str


class UserIn(BaseModel):
    email: EmailStr
    name: str
    role: str
    password: str
    investor_id: str | None = None


class ResetIn(BaseModel):
    password: str


def public(u):
    return {k: u.get(k) for k in ("user_id", "email", "name", "role", "investor_id", "created_at", "reset_requested_at")}


@auth_router.post("/auth/login")
async def login(body: LoginIn, request: Request):
    email = body.email.lower()
    key = f"{request.client.host if request.client else ''}:{email}"
    rec = await db.login_attempts.find_one({"key": key})
    if rec and rec.get("locked_until") and rec["locked_until"] > now_iso():
        raise HTTPException(429, f"Too many failed attempts. Try again in {LOCK_MIN} minutes.")
    u = await db.users.find_one({"email": email}, {"_id": 0})
    if not u or not u.get("password_hash") or u.get("disabled") or not check_pw(body.password, u["password_hash"]):
        fails = (rec or {}).get("fails", 0) + 1
        upd = {"fails": fails}
        if fails >= MAX_FAILS:
            upd = {"fails": 0, "locked_until": (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MIN)).isoformat()}
        await db.login_attempts.update_one({"key": key}, {"$set": upd}, upsert=True)
        raise HTTPException(401, "Incorrect email or password")
    await db.login_attempts.delete_one({"key": key})
    return {"token": make_token(u["user_id"]), "user": public(u)}


@auth_router.post("/auth/forgot")
async def forgot(body: ForgotIn):
    u = await db.users.find_one({"email": body.email.lower(), "password_hash": {"$exists": True}})
    hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    if u and not u.get("disabled") and (u.get("reset_requested_at") or "") < hour_ago:
        await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"reset_requested_at": now_iso()}})
        await notify("staff", "PASSWORD_RESET_REQUEST", "Password reset requested",
                     f"{u.get('name') or u['email']} ({u['email']}) forgot their password. Reset it in Users & Logins.", "/users")
    return {"ok": True}


@auth_router.post("/auth/change-password")
async def change_password(body: ChangePwIn, m: dict = Depends(current_member)):
    u = await db.users.find_one({"user_id": m["user_id"]})
    first = bool(u.get("must_change_password"))
    if not first and not check_pw(body.current_password, u.get("password_hash", "")):
        raise HTTPException(400, "Current password is incorrect")
    strong(body.new_password)
    if check_pw(body.new_password, u.get("password_hash", "")):
        raise HTTPException(400, "Choose a new password, different from the one you were given")
    await db.users.update_one({"user_id": m["user_id"]}, {"$set": {"password_hash": hash_pw(body.new_password), "must_change_password": False}})
    await audit(m, "PASSWORD_CHANGED", "user", m["user_id"])
    return {"ok": True}


@auth_router.post("/users")
async def create_user(body: UserIn, m: dict = Depends(require("users"))):
    if body.role not in ROLES or body.role == "pending":
        raise HTTPException(400, "Invalid role")
    strong(body.password)
    email = body.email.lower()
    if await db.users.find_one({"email": email, "password_hash": {"$exists": True}}):
        raise HTTPException(409, "A user with this email already exists")
    inv = None
    if body.role == "investor":
        if not body.investor_id or not await db.investors.find_one({"id": body.investor_id}):
            raise HTTPException(400, "Select the investor account to link")
        inv = body.investor_id
    await db.users.delete_many({"email": email, "password_hash": {"$exists": False}})
    u = {"user_id": new_id(), "email": email, "name": body.name.strip() or email, "role": body.role, "investor_id": inv,
         "password_hash": hash_pw(body.password), "must_change_password": body.role == "investor", "created_at": now_iso()}
    await db.users.insert_one(u)
    await audit(m, "USER_CREATED", "user", u["user_id"], {"email": email, "role": body.role})
    return public(u)


@auth_router.post("/users/{user_id}/password")
async def reset_password(user_id: str, body: ResetIn, m: dict = Depends(require("users"))):
    strong(body.password)
    t = await db.users.find_one({"user_id": user_id})
    if not t:
        raise HTTPException(404, "Not found")
    await db.users.update_one({"user_id": user_id}, {"$set": {"password_hash": hash_pw(body.password),
                                                             "must_change_password": effective_role(t.get("role")) == "investor",
                                                             "reset_requested_at": None}})
    await audit(m, "PASSWORD_RESET", "user", user_id)
    return {"ok": True}


@auth_router.delete("/users/{user_id}")
async def delete_user(user_id: str, m: dict = Depends(require("users"))):
    if user_id == m["user_id"]:
        raise HTTPException(400, "You cannot delete your own account")
    t = await db.users.find_one({"user_id": user_id})
    if not t:
        raise HTTPException(404, "Not found")
    if t.get("role") == "admin" and await db.users.count_documents({"role": "admin", "password_hash": {"$exists": True}}) <= 1:
        raise HTTPException(409, "Keep at least one Super Admin")
    await db.users.delete_one({"user_id": user_id})
    await audit(m, "USER_DELETED", "user", user_id, {"email": t.get("email")})
    return {"ok": True}
