# Wheelspa PPF ledger API regression tests.
# Auth: Clerk session tokens are short-lived (~60s) and can only be minted in the browser
# (window.Clerk.session.getToken()). Set WS_TOKEN_<ROLE> env vars (ADMIN/ACCOUNTS/MGMT/INVESTOR)
# right before running to execute authenticated read checks; otherwise they are skipped.
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
API = f"{BASE_URL}/api"

PROTECTED = ["/me", "/sales", "/investors", "/dashboard", "/ledger", "/settlements", "/reconciliation",
             "/reports", "/audit", "/users", "/queries", "/transfers", "/rolls", "/notifications"]


def tok(role):
    t = os.environ.get(f"WS_TOKEN_{role}")
    if not t:
        pytest.skip(f"WS_TOKEN_{role} not set")
    return {"Authorization": f"Bearer {t}"}


# --- Auth guard: every protected endpoint rejects missing/invalid tokens ---
@pytest.mark.parametrize("path", PROTECTED)
def test_protected_requires_auth(path):
    r = requests.get(API + path, timeout=20)
    assert r.status_code == 401


def test_invalid_bearer_rejected():
    r = requests.get(API + "/me", headers={"Authorization": "Bearer garbage"}, timeout=20)
    assert r.status_code == 401
    assert "detail" in r.json()


def test_write_endpoints_require_auth():
    assert requests.post(API + "/sales", json={}, timeout=20).status_code in (401, 422)
    assert requests.post(API + "/ledger/TXN-000001/reverse", json={"reason": "x"}, timeout=20).status_code in (401, 422)


# --- Seeded acceptance scenario (needs admin token) ---
def test_seeded_pricing_and_balances():
    h = tok("ADMIN")
    inv = requests.get(API + "/investors", headers=h, timeout=20).json()
    a = next(i for i in inv if i["name"] == "Sample Investor A")
    assert a["balances"]["invested"] == 250000000
    sales = {s["order_no"]: s for s in requests.get(API + "/sales", headers=h, timeout=20).json()}
    p = sales["SO-00001"]["pricing"]
    assert (p["base"], p["margin"], p["investor_margin"], p["wheelspa_margin"], p["taxable"], p["gst"], p["total"]) == \
        (3125000, 937500, 468750, 468750, 4062500, 731250, 4793750)


def test_reconciliation_ok():
    r = requests.get(API + "/reconciliation", headers=tok("ADMIN"), timeout=30)
    assert r.status_code == 200 and r.json()["ok"] is True


# --- Role permissions ---
def test_investor_forbidden_writes():
    h = tok("INVESTOR")
    assert requests.post(API + "/sales", headers=h, json={"customer_name": "TEST_x", "roll_id": "x", "order_date": "2026-10-21"}, timeout=20).status_code == 403
    assert requests.get(API + "/audit", headers=h, timeout=20).status_code == 403


def test_accounts_cannot_verify_or_reverse():
    h = tok("ACCOUNTS")
    assert requests.post(API + "/transfers/none/verify", headers=h, timeout=20).status_code == 403
    assert requests.post(API + "/ledger/TXN-000001/reverse", headers=h, json={"reason": "TEST"}, timeout=20).status_code == 403


# --- Super Admin edit / remove endpoints (iteration_2): unauthenticated access rejected ---
def test_admin_edit_requires_auth():
    r = requests.patch(API + "/admin/investors/x", json={"fields": {"phone": "1"}, "reason": "TEST_"}, timeout=20)
    assert r.status_code == 401


def test_admin_remove_requires_auth():
    r = requests.post(API + "/admin/sales/x/remove", json={"mode": "void", "reason": "TEST_"}, timeout=20)
    assert r.status_code == 401
