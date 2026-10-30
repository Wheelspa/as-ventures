import io
import logging

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from core import db, audit, now_iso
import finance as F
from storage import save_document

log = logging.getLogger("seed")
SYS = {"user_id": "system", "name": "System (sample data)", "email": "", "role": "admin"}


def _pdf(title, lines):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(60, 780, title)
    c.setFont("Helvetica", 10)
    for i, ln in enumerate(["SAMPLE DOCUMENT - for demonstration only"] + lines):
        c.drawString(60, 750 - i * 16, ln)
    c.save()
    return buf.getvalue()


async def _doc(name, title, lines):
    return (await save_document(SYS, name, _pdf(title, lines), "application/pdf"))["id"]


async def _sale(roll, order_date, invoice_date, cust, vehicle):
    s = await F.create_sale(SYS, {"customer_name": cust, "customer_code": "", "vehicle": vehicle, "roll_id": roll["id"], "order_date": order_date})
    if invoice_date:
        await F.invoice_sale(SYS, s["id"], {"invoice_date": invoice_date, "doc_id": await _doc(f"invoice_{s['order_no']}.pdf", "Sample tax invoice", [s["order_no"], cust])})
    return s


async def _collect(sale, amount, date, ref):
    await F.record_collection(SYS, sale["id"], {"amount": amount, "date": date, "mode": "Bank transfer", "reference": ref})


async def _transfer(sale, kind, amount, date, ref, verify):
    st = await db.settlements.find_one({"sale_id": sale["id"]}, {"_id": 0})
    doc = await _doc(f"proof_{ref}.pdf", "Sample bank transfer advice", [f"UTR {ref}", f"{kind} Rs. {amount}"])
    t = await F.create_transfer(SYS, st["id"], {"kind": kind, "amount": amount, "date": date, "bank_ref": ref, "doc_id": doc})
    if verify:
        await F.verify_transfer(SYS, t["id"])
    return st


async def seed():
    if await db.investors.count_documents({}) > 0:
        return
    log.info("Seeding sample acceptance scenario")
    inv = await F.create_investor(SYS, {"name": "Sample Investor A", "email": "investor.sample@example.com", "phone": "",
                                        "pan": "", "bank_details": "[Investor bank account placeholder]"})
    ag = await F.propose_agreement(SYS, inv["id"], {"default_base_price": 31250, "margin_pct": 30, "investor_share_pct": 50, "gst_pct": 18,
                                                    "gst_mode": "full_value", "settlement_days": 7, "effective_from": "2026-07-01",
                                                    "notes": "Sample terms - to be reviewed by Wheelspa's CA"})
    await F.decide_agreement(SYS, ag["id"], True)
    proof = await _doc("capital_UTR-SAMPLE-0001.pdf", "Sample capital receipt", ["Rs. 25,00,000 received"])
    await F.record_investment(SYS, {"investor_id": inv["id"], "amount": 2500000, "date": "2026-07-05", "bank_ref": "UTR-SAMPLE-0001",
                                    "doc_id": proof, "terms_note": "Base ₹31,250/roll · 30% margin split 50:50 · GST 18% separate"})
    common = {"supplier": "Sample PPF Supplier Pvt Ltd", "brand": "Sample PPF", "thickness": "8.5 mil", "specs": "1.52 m x 15 m",
              "unit_cost": 26000, "gst_pct": 18, "other_charges": 0, "base_price": 31250, "funding": [{"investor_id": inv["id"], "pct": 100}]}
    p1 = await F.create_purchase(SYS, {**common, "supplier_invoice": "SUP-INV-1001", "purchase_date": "2026-07-10", "series": "Ultra Gloss",
                                       "qty": 40, "amount_paid": 1227200,
                                       "invoice_doc_id": await _doc("SUP-INV-1001.pdf", "Sample supplier invoice", ["40 rolls"])})
    await F.create_purchase(SYS, {**common, "supplier_invoice": "SUP-INV-1002", "purchase_date": "2026-08-20", "series": "Matte Pro",
                                  "qty": 32, "amount_paid": 490880})
    rolls = await db.rolls.find({"purchase_id": p1["id"]}, {"_id": 0}).sort("roll_id", 1).to_list(100)

    s1 = await _sale(rolls[0], "2026-08-01", "2026-08-02", "Sample Customer 01", "Sample SUV")
    await _collect(s1, 47937.50, "2026-08-05", "NEFT-SAMPLE-C01")
    st1 = await _transfer(s1, "principal", 31250, "2026-08-08", "UTR-SAMPLE-T01", True)
    await _transfer(s1, "margin", 4687.50, "2026-08-08", "UTR-SAMPLE-T01", True)
    await F.acknowledge({"user_id": "system", "name": "Sample Investor A", "role": "investor", "investor_id": inv["id"]}, st1["id"],
                        "Received ₹35,937.50 — reconciled")

    s2 = await _sale(rolls[1], "2026-09-10", "2026-09-11", "Sample Customer 02", "Sample Sedan")
    await _collect(s2, 47937.50, "2026-09-14", "NEFT-SAMPLE-C02")
    await _transfer(s2, "principal", 31250, "2026-09-16", "UTR-SAMPLE-T02", True)
    await _transfer(s2, "margin", 4687.50, "2026-09-16", "UTR-SAMPLE-T03", True)

    s3 = await _sale(rolls[2], "2026-09-20", "2026-09-21", "Sample Customer 03", "Sample Coupe")
    await _collect(s3, 47937.50, "2026-09-25", "NEFT-SAMPLE-C03")

    s4 = await _sale(rolls[3], "2026-10-08", "2026-10-09", "Sample Customer 04", "Sample Hatchback")
    await _collect(s4, 47937.50, "2026-10-14", "NEFT-SAMPLE-C04")
    await _transfer(s4, "principal", 31250, "2026-10-16", "UTR-SAMPLE-T04", True)
    await _transfer(s4, "margin", 4687.50, "2026-10-17", "UTR-SAMPLE-T05", False)

    s5 = await _sale(rolls[4], "2026-10-10", "2026-10-11", "Sample Customer 05", "Sample SUV")
    await _collect(s5, 23968.75, "2026-10-15", "NEFT-SAMPLE-C05")
    await _transfer(s5, "principal", 15625, "2026-10-16", "UTR-SAMPLE-T06", False)

    await _sale(rolls[5], "2026-10-16", "2026-10-16", "Sample Customer 06", "Sample Sedan")
    await _sale(rolls[6], "2026-10-18", None, "Sample Customer 07", "Sample MPV")

    dmg = await db.rolls.find_one({"status": "in_stock", "series": "Matte Pro"}, {"_id": 0}, sort=[("roll_id", -1)])
    await db.rolls.update_one({"id": dmg["id"]}, {"$set": {"status": "damaged"},
                              "$push": {"status_history": {"status": "damaged", "at": now_iso(), "by": SYS["name"], "reason": "Sample: edge damage in transit"}}})
    await audit(SYS, "ROLL_STATUS_CHANGED", "roll", dmg["id"], {"to": "damaged", "reason": "Sample: edge damage in transit"})
    log.info("Seed complete")
