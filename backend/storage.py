import os

import requests
from starlette.concurrency import run_in_threadpool

from core import db, new_id, now_iso, actor, can

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = os.environ["APP_STORAGE_PREFIX"]
storage_key = None


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def _req(method, path, **kw):
    for attempt in range(2):
        resp = requests.request(method, f"{STORAGE_URL}/objects/{path}",
                                headers={"X-Storage-Key": init_storage(force=attempt == 1), **kw.pop("headers", {})}, **kw)
        if resp.status_code != 404 or attempt == 1:
            break
    resp.raise_for_status()
    return resp


def put_object(path: str, data: bytes, content_type: str) -> dict:
    return _req("PUT", path, headers={"Content-Type": content_type}, data=data, timeout=120).json()


def get_object(path: str):
    resp = _req("GET", path, timeout=60)
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def save_document(m, filename: str, data: bytes, content_type: str) -> dict:
    did = new_id()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    result = await run_in_threadpool(put_object, f"{APP_NAME}/uploads/{m['user_id']}/{did}.{ext}", data, content_type)
    doc = {"id": did, "filename": filename, "storage_path": result["path"], "content_type": content_type, "size": len(data),
           "uploaded_by": actor(m), "uploaded_by_id": m["user_id"], "is_deleted": False,
           "investor_ids": [m["investor_id"]] if m.get("investor_id") and not can(m, "staff") else [], "created_at": now_iso()}
    await db.documents.insert_one(doc)
    return {"id": did, "filename": filename}
