import os
from gridfs import GridFS
from pymongo import MongoClient
from starlette.concurrency import run_in_threadpool
from core import db, new_id, now_iso, actor, can
APP_NAME = os.environ["APP_STORAGE_PREFIX"]
_client = MongoClient(os.environ["MONGO_URL"])
_fs = GridFS(_client[os.environ["DB_NAME"]], collection="files")
def init_storage(force: bool = False):
    return True
def put_object(path: str, data: bytes, content_type: str) -> dict:
    _fs.put(data, filename=path, content_type=content_type)
    return {"path": path}
def get_object(path: str):
    f = _fs.find_one({"filename": path})
    if f is None:
        raise FileNotFoundError(path)
    return f.read(), (f.content_type or "application/octet-stream")
async def save_document(m, filename: str, data: bytes, content_type: str) -> dict:
    did = new_id()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    result = await run_in_threadpool(put_object, f"{APP_NAME}/uploads/{m['user_id']}/{did}.{ext}", data, content_type)
    doc = {"id": did, "filename": filename, "storage_path": result["path"], "content_type": content_type, "size": len(data),
           "uploaded_by": actor(m), "uploaded_by_id": m["user_id"], "is_deleted": False,
           "investor_ids": [m["investor_id"]] if m.get("investor_id") and not can(m, "staff") else [], "created_at": now_iso()}
    await db.documents.insert_one(doc)
    return {"id": did, "filename": filename}
