import logging
import os

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

try:  # launched as `backend.server` (the default)
    from backend.clerk_auth import clerk_router, require_user  # noqa: F401
except ModuleNotFoundError:  # launched from inside backend/ as `server`
    from clerk_auth import clerk_router, require_user  # noqa: F401

from core import db, client, RETIRED_ROLES
from routes import api
from auth import auth_router, seed_admin
from storage import init_storage

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Wheelspa PPF Investor Transparency Portal")
app.include_router(api)
app.include_router(auth_router)
app.include_router(clerk_router)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    for old, new in RETIRED_ROLES.items():
        await db.users.update_many({"role": old}, {"$set": {"role": new}})
    await db.rolls.create_index("roll_id", unique=True)
    await db.rolls.create_index("id", unique=True)
    await db.sales.create_index("roll_ref", unique=True, partialFilterExpression={"active": True})
    await db.sales.create_index("order_no", unique=True)
    await db.settlements.create_index([("sale_id", 1), ("investor_id", 1)], unique=True)
    await db.ledger.create_index("txn_id", unique=True)
    await db.ledger.create_index("reversal_of", unique=True, partialFilterExpression={"reversal_of": {"$type": "string"}})
    await db.investments.create_index("bank_ref", unique=True)
    await db.transfers.create_index([("settlement_id", 1), ("kind", 1), ("bank_ref", 1)], unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.invites.create_index("email", unique=True)
    await seed_admin()
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    client.close()
