# PRD — Wheelspa PPF Distribution & Investor Transparency Portal

## Original problem statement
The customer's full brief (summarised here; their exact text is in the job's first message): "Build a professional, secure, web-based portal named Wheelspa PPF Distribution & Investor Transparency Portal for Wheelspa Private Limited… to ensure that the investor and Wheelspa can transparently track every rupee invested, every PPF roll purchased and sold, the 30% margin distribution, and the return of the investor's principal on an order-by-order basis." It covers investor funding, roll procurement with unique IDs, pricing (base + 30% margin split 15/15 + 18% GST kept separate), order-to-order principal recovery, a settlement workflow with bank-proof verification, investor and admin dashboards, an immutable ledger with reversals, transparency features, multiple investors, 12 reports in PDF and Excel, notifications, four roles, INR / Indian numbering / IST, validation rules and the ₹25,00,000 acceptance scenario.

User choices: email and password login with access granted by the Super Admin and no open access; in-app notifications only; uploads on local disk (switched to Emergent object storage because files on local disk are lost when the app is deployed); MongoDB with backend-enforced constraints; seeded acceptance scenario. Owner admin: uwacreations@gmail.com.

## Architecture
- Backend: FastAPI (core.py for auth, roles, ledger and audit helpers; finance.py for all money logic in integer paise; routes.py; reports.py for reports, dashboard, reconciliation and PDF/XLSX; storage.py for object storage; seed.py).
- Auth: Emergent-managed Clerk. Roles: admin, management, accounts, investor, pending. Permissions are checked on the backend, and investor data is limited to their own investor_ids.
- Integrity: unique indexes (roll_id, active sale per roll, settlement per sale and investor, txn_id, single reversal, investment bank_ref), atomic conditional updates for funds, collections and transfer caps, separation of duties (uploader ≠ verifier, proposer ≠ approver).
- Frontend: React + shadcn, dark premium theme (Cabinet Grotesk / IBM Plex Sans / JetBrains Mono), recharts.

## Personas
Super Admin, Wheelspa Accounts, Wheelspa Management, Investor (read-only, acknowledges and raises queries).

## Implemented (2026-10-21)
- Investors, versioned commercial terms with approval and effective dates, investments with proof.
- Purchases creating unique rolls with funding allocation (multi-investor %), supplier payments.
- Sales: reserve → invoice (roll sold) → partial or full collections → pro-rata principal and margin recoverable → transfer proofs → verification → settled; investor acknowledgement and queries.
- Append-only ledger with linked refs and docs, reversals (with operational sync) and adjustments; audit trail.
- Admin and investor dashboards, roll trace, settlements, pending verifications, reconciliation checks, 12 reports plus per-order statement in PDF and XLSX, monthly statement publishing, in-app notifications (including overdue and low-funds alerts), Users & Access with email pre-approval.
- Seeded acceptance scenario (7 orders at different stages, 1 damaged roll).

- 2026-10-21: Super Admin edit and delete. Descriptive and amount edits post correcting ledger entries and recalculate balances; date edits re-date the linked ledger entries. Remove offers void (hidden, kept) or permanent delete, both with a reason and dependency checks. Everything is audited with before/after values.

- 2026-10-21: All business data and test logins deleted at the owner's request; automatic sample seeding disabled (seed.py kept but no longer run).

- 2026-10-21: Login removed at the owner's request ("skip login for now"). The portal opens directly as Super Admin, and a top-bar "View as" switcher previews Management, Accounts and each investor. The role travels in request headers (X-Act-As / X-Investor-Id) and is not secure. The Clerk code is kept but unused; the Users & Access page is hidden.

- 2026-10-27: Portal renamed to S & A Ventures. Roll principal = purchase value excl. GST ((subtotal + other charges) / qty), and the terms base price is auto-set to the average of that. 30% income tax (configurable tax_bp) comes off the margin before the 50:50 split, posted as an INCOME_TAX ledger entry on collection. One batch number per purchase (roll IDs = BATCH-01..NN). Delete is one click (permanent). The dashboard shows capital added/returned and the profit-share calculation.

- 2026-10-27: Simple one-screen email + password login (custom JWT HS256, bcrypt, 12h tokens, 5-fail/15-min lockout). Super Admin is seeded from ADMIN_EMAIL/ADMIN_PASSWORD; there is no public sign-up. The Super Admin creates logins (with investor link), resets passwords and deletes logins on /users; users can change their own password. The View-as switcher is removed. PO-0004 recalculation skipped: the purchase had already been deleted.

- 2026-10-27: Welcome screen for an investor's first sign-in. Investor logins created or reset by the admin get must_change_password=true. On first sign-in the investor sees a one-time screen to set their own password (8+ characters, typed twice, different from the one given); the current password is not asked for while the flag is set. After saving, the dashboard opens.

- 2026-10-27: Forgot password request. The login page has a "Forgot password?" link. POST /api/auth/forgot always returns ok, so it never reveals whether an email has a login. For a real login it sets reset_requested_at and sends a staff in-app notification linking to /users, at most once per hour per user. Users & Logins shows an "Asked for a password reset" badge, which clears when the admin resets the password.

- 2026-10-27: Direct bulk sales. "Sales Orders" is renamed "Sales". A new sale is one step: pick a purchase batch, the number of rolls, customer and sale date. The sale is invoiced at once (invoice number auto or entered) and the rolls are marked sold, oldest roll IDs first, kept internally only. An optional "amount received now" plus reference records the first customer payment. Pricing = per-roll base × qty, run through the same margin, tax and GST engine. New sales use the SALE-00001 numbering and carry qty, roll_refs, batch_no and purchase_id. GET /api/stock/batches lists in-stock counts per batch. Preview takes {purchase_id, qty, sale_date}. Older SO- orders keep their invoice and cancel flow. Deleting a sale releases all its rolls.

- 2026-10-27: Sale margin is editable per sale (margin_pct, default 30%) and applied to the purchase value excl. GST. Approved terms are no longer required to sell. The investor's approved terms are used if present, for tax %, split, GST and settlement days; otherwise DEFAULT_TERMS applies (30% tax, 50:50 split, 18% GST on full value, 7 days). "Amount received now" auto-fills with the calculated total and can be edited or cleared.

- 2026-10-28: Multi-product purchase invoices. POST /api/purchases now takes one supplier invoice (supplier, invoice no, date, other_charges, amount_paid, funding, docs) plus items[] (brand, series, thickness, specs, qty, unit_cost, gst_pct). Each product is saved as its own purchase: own PO number and batch, all linked by invoice_group. Other charges are split across products by value. The amount paid is applied to products in order. Investor funds are checked for the whole invoice before anything is saved.

- 2026-10-28: Inventory by batch. The PPF Inventory page shows one row per purchase batch with bought, in stock, sold (incl. old reserved), damaged/returned, landed cost (staff only), principal per roll, stock value and funding. It also has summary tiles and All / In stock / Sold out filters. Data comes from GET /api/inventory/batches (investor-scoped, with q and investor_id filters). Per-roll IDs are no longer shown; the roll trace route still exists internally.

- 2026-10-28: Low stock alert. The dashboard response includes low_stock (staff only): batches with 1–2 rolls in stock. The dashboard shows an amber alert with a "Log a new purchase" link.
- 2026-10-28: Erase all data. POST /api/admin/erase-all {confirm:"DELETE"} is Super Admin only (perm "edit"). It deletes all business collections (agreements, investments, purchases, investors, counters, settlements, documents, sales, rolls, transfers, collections, ledger, queries, notifications, invites, audit). It keeps users and login_attempts, unlinks investor logins, and writes one ALL_DATA_ERASED audit entry. The UI is a "Danger zone" panel on Users & Logins; the button stays disabled until DELETE is typed.








## Backlog
- P1: shadcn date pickers and dialogs in place of native date inputs and browser prompts; warning in the purchase form when capital exceeds available funds.
- P2: optional email notifications; tax-invoice PDF generation; cron for daily overdue alerts.

## Next tasks
CA review of GST and accounting settings; replace sample names and amounts with real data.
