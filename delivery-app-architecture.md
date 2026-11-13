# Delivery app: architecture (draft v1)

Drafted 2026-11-10. Builds on `smart-pos-database-map` and `smart-pos-feature-inventory`.

## Status
- **2026-11-11 — DB read access proven on the live Main PC.** JetCheck (x86, .NET 10) opened `C:\Smart\smart1.mdb` read-only via `Microsoft.Jet.OLEDB.4.0` and verified all 4 tables / 75 allowlisted columns, both as the owner and as the dedicated `SmartSync` service account (read-only NTFS). Live counts: CUST 8,676 · INV 80,106 · ITEM 176,555 · EDITINV 30,331 · open tickets 1,195.
- The Smart DB is **password-protected** (vendor-set). Access uses the supported Jet path with the password supplied only via the `SmartDbPassword` env var / service credential — never in code, files, logs or git.
- **Concurrency checked (2026-11-11):** JetCheck run with Smart open and in use on the Main PC — no visible impact on Smart. (A busy multi-station rush hasn't been tested, but read-only shared access is designed for it.)
- **2026-11-12 — full sync agent built (phases A0–A9), 193 agent tests + 23 API integration tests, pushed to private GitHub `Nick-Bae/cleaners`.** Core (models/hashing/tz/allowlist), ISmartSource + FixtureSmartSource, SQLite state, cycle orchestrator + 5 loops, HTTP batch/heartbeat, host wiring, JetSmartSource (real Jet reader), E2E dry-run against fixtures, MakeFixtures anonymizer.
- API (ingest, mapping, Postgres mirror→core tables) built and tested.
- **2026-11-12 — first end-to-end run DONE, then RE-VERIFIED CLEAN (at home, anonymized fixtures → Supabase).** Pipeline proven: agent → API → cloud Postgres at full volume. Customers synced exactly (8,669). The dry run caught and fixed 6 real data/logic bugs: (1) reconcile skipped customers with null EDITDATE (fixed: GetAllCustomers for reconcile), (2) empty-CUSTID guest tickets crashed/rejected (fixed: skip + warn), (3) duplicate INVNUM (fixed: in-batch dedupe + last-wins), (4) orphan items from skipped tickets, (5) `#CASH` walk-in placeholder customers warned forever (fixed: re-queue backoff after 3 tries), (6) ~4% of reconcile-path tickets not persisting.
- **2026-11-12 — bug #6 ROOT-CAUSED & FIXED (commit `71d3667`), re-run PASSED.** Root cause: the agent's chunker **interleaved customers and tickets**, so a ticket in batch K referencing a customer in batch K+5 hit the API before its customer existed, got dropped as `missingCustomerIds`, and because `row_hashes` commits at enqueue (not on API ack) it was never re-emitted — a silent ~4% loss. Fix (3 parts): (a) **agent chunker now phases all customer batches first, then all ticket+item batches** — every CUSTID is in the cloud before any ticket references it; (b) **API now returns `skipped_ticket_invoice_numbers` + logs `[sync/batch] tickets_dropped`** so any future skip is visible, plus server-side in-batch last-wins dedupe; (c) agent treats skips as force-reread via WarningBackoff (self-healing). Re-run result: **customers 8,669 · tickets 79,610 · ticket_items 175,439 · zero `tickets_dropped` lines.** The 79,610 (vs 79,826 sent) is **correct, not loss** — verified against the fixtures: exactly **216 orphan tickets reference 61 CUSTIDs that have no customer row in Smart** (dangling refs in the source Access data; note every Smart customer ID is `#`-prefixed, so the `#` is not the marker — these are simply deleted/merged customers plus `#CASH`). 79,826 − 216 orphans = 79,610 resolvable, all persisted. Orphans now explicitly reported (`unknown_invoices` per batch + warning backoff), never silently dropped. Net vs the old run: recovered ~3,030 tickets; silent loss eliminated.
- **Open decision (not a bug):** what to do with the 216 orphan tickets (61 missing CUSTIDs) in production — drop them (current), or create placeholder/`unknown` customer rows so the historical tickets come through. Delivery doesn't need them (no customer to deliver to); the future POS mirror might want them. Decide at the real-data run. **Spot-check `#1007954` (78 orphan invoices) in Smart's customer screen** — if it's found, the full-customer read has a gap; if not, confirmed deletion.
- **2026-11-13 — Track A chosen (build the apps). Frontend decision: COMBINE, not separate.** The marketing site (`Nick-Bae/greencleaners`, a single static HTML page, brand-new and barely trafficked, so no SEO/traffic to protect) folds **into** the delivery web app as the public `/` homepage. One Next.js app in `apps/web` of the `cleaners` monorepo serves everything, role-gated. Routes: `/` (public: hours, services, location, **Schedule a Pickup** CTA), `/pickup` (customer requests a pickup), `/account` (signed-in customer: their requests + order status), `/staff` (owner/staff: review requests, assign stops), `/driver` (drivers: assigned stops, update pickup/delivery status). **Driver is browser-first for the MVP** (mobile web page; Code 39 scanning works in-browser via BarcodeDetector/ZXing — already verified); graduate to Expo/native only if background push or background GPS become needed. Deploy to a preview URL, test one full flow (homepage CTA → pickup request → staff assign → driver update), then point `greencleanerspro.com` at the new deployment and keep the old deploy for rollback (verify the site's actual current host first — don't assume Netlify).
- **Not yet done:** (a) build `apps/web` (combined site, Phase 2 = staff dashboard first). (b) raw-real-data run against the production DB (with backups + access controls). (c) Windows service install + secure credential storage (task #32).
- **Infra note:** Supabase free-tier project `cleaners-firstrun` is a throwaway test DB (anonymized data only) — delete it, don't promote it. Production provider decision (Supabase vs Google Cloud SQL, since user runs Google Cloud for Bible Memos) still open. Build `apps/web` against the test Supabase for now.

## Principles
1. **Smart stays the system of record** for tickets, prices and payments taken at the counter. Staff keep using it as today.
2. **The delivery app is an add-on.** It reads Smart's data and keeps its own data (pickup requests, routes, scans, app payments) in its own cloud database.
3. **No writes to Smart at first.** Later, only low-risk customer fields (address, delivery note, cell, email), done on the Main PC with the Jet driver.
4. **Order-level tracking** using the invoice barcode Smart already prints. No garment barcodes for now.
5. **Designed for replacing Smart later** (decided 2026-11-11). The cloud owns core tables (`customers`, `tickets`, `ticket_items`) shaped for the owner's future POS. Smart is just one *source*: each synced row has `source = 'smart'` + `source_id` (Smart `CUST.ID` / `INV.INVNUM`). Only one mapping module knows Smart's column names. When the new POS replaces Smart, it writes `source = 'native'` rows into the same tables, the sync agent is retired, and the delivery app is unchanged. Invoice numbers can continue from Smart's last number.

## Components

```
 Shop (Main PC)                         Cloud                                Phones / browsers
 ┌──────────────────────┐   HTTPS   ┌──────────────────────────┐     ┌──────────────────────┐
 │ smart1.mdb (Smart)   │           │ API (Node/TypeScript)    │ ◄──►│ Customer app (PWA)   │
 │        ▲ read-only   │           │ Postgres (Supabase)      │     ├──────────────────────┤
 │ Sync agent (.NET     │ ────────► │  - core tables           │ ◄──►│ Driver app (PWA,     │
 │  Windows service)    │  push     │  - delivery tables       │     │  camera scanning)    │
 └──────────────────────┘           │ Stripe · Twilio · Maps   │     ├──────────────────────┤
                                    └──────────────────────────┘ ◄──►│ Staff dashboard (web)│
                                                                     └──────────────────────┘
```

| Component | Runs on | Stack (proposed) |
|---|---|---|
| Sync agent | Main PC (where `smart1.mdb` lives) | C#/.NET Windows service, 32-bit Jet/Access OLE DB driver, read-only connection |
| API + database | Cloud | Node/TypeScript API, Postgres (Supabase), auth, webhooks |
| Public site + customer app | Customer phones / browsers | **One Next.js app** (`apps/web`), mobile-first. Public `/` marketing homepage (folds in the old static site) + customer `/pickup` `/account`. |
| Driver app | Driver phone | **Browser-first (mobile web `/driver`) for MVP** — Code 39 scanning in-browser (BarcodeDetector/ZXing). Expo/React Native later only if background push/GPS needed. |
| Staff dashboard | Counter PC browser | **Same Next.js app** (`/staff`), role-gated. |
| Payments | Stripe | Saved cards, charge on delivery, webhooks |
| Texts | Twilio (or similar) | Requires US 10DLC registration |
| Maps | Google Maps Platform or Mapbox | Address autocomplete, geocoding, route ordering |

## Tech stack (decided 2026-11-11 "Option B"; frontend combine-decision 2026-11-13)
- **One TypeScript monorepo** (`Nick-Bae/cleaners`). Shared packages for types + zod validation so web, mobile and API agree on shapes.
- **Web (Next.js, `apps/web`):** one role-gated app serving the **public marketing homepage**, **customers**, **staff/admin**, and (MVP) the **driver** page. Route/role decides what's shown. The old static marketing site (`Nick-Bae/greencleaners`) is absorbed as `/`.
- **Driver:** **browser-first for the MVP**; Expo / React Native only if background push, background GPS, or offline scanning become real needs.
- **API + Postgres:** as already built (Node/TypeScript, Supabase).
- **Sync agent:** C# / .NET 10 (unchanged; proven 2026-11-11).
- One backend, one account system; **role-based access** (customer / driver / admin).

## Customer onboarding (existing vs new)
Matching key = **phone number** (`customers.phone`; every Smart customer has one). Link only after the phone is verified.
- **New customer:** sign up, create account, `customers` row `source='native'`, no Smart history.
- **Existing customer:** enter phone → **SMS code to verify ownership** → match against mirrored Smart customers:
  - exactly one match → link the `customers_app` login to that `customers` row ("welcome back").
  - multiple matches (shared/family phone) → show the names, let them pick; **never auto-merge**.
  - no match → treat as new.
- **Privacy:** reveal nothing about an existing account until the phone is verified.
- **Landline-only customers** (no mobile / SMS off): **link at the counter** — staff look them up and send an invite to a new mobile, or hand a short code to enter in the app.
- **Optional proactive invite** (later, needs 10DLC): text existing customers who have a cell + SMS on; respect opt-in.

## Sync agent design
Access has no built-in change tracking, so the agent polls on a short interval and sends only what changed.

| Data | How to find changes | Interval |
|---|---|---|
| Customers (`CUST`) | `EDITDATE` / `EDITTIME`, plus new IDs | every 5 min |
| Open tickets (`INV` where `PICKUP = 'N'`) | full scan of open tickets (~1,000 rows), compare hash per row | every 1–2 min |
| Recent tickets (`INV`, last ~60 days) | catch newly picked-up / voided tickets | every 5 min |
| Garment lines (`ITEM`) | fetched by `INVNUM` for any changed ticket | with tickets |
| Edits (`EDITINV`) | new rows since last check, to re-sync that ticket | every 5 min |

Rules:
- Open the database **read-only**, short queries, close quickly. Never lock tables.
- Send only fields the app needs. **Never send card fields** (`CARDNUM`, `CREDITCARD`, `EXPDATE`, `Trans`), employee data or settings.
- Queue locally if the internet is down; resend later.
- Reconcile phases **all customer batches before any ticket batch** (bug #6 fix) so no ticket forward-references a not-yet-synced customer.
- Health check: the API alerts if the agent hasn't reported in 15 minutes.

## Cloud data (delivery side)
Core tables (app-owned, shaped for the future POS): `customers`, `tickets`, `ticket_items`. Each has `source` (`smart` | `native`), `source_id`, unique (`source`, `source_id`), and `invoice_number` (string, unique) on tickets. The sync agent sends Smart-shaped data; the API's Smart mapping module (e.g. `api/src/sources/smart/`) translates it into these tables. Rows with `source = 'smart'` are read-only for the app.

Delivery tables (owned by the app):
- `customers_app`: app login, phone (link key to `customers.phone`), address(es), delivery notes, Stripe customer ID
- `delivery_requests`: pickup / delivery request, time window, status
- `delivery_orders`: links a request to one or more `tickets` (by ticket id)
- `routes`, `route_stops`: date, driver, stop order
- `scans`: invoice barcode scans (who, when, where, which step)
- `payments_app`: Stripe payments taken in the app
- `notifications`: texts sent

## Order flow

| Status | Triggered by |
|---|---|
| Requested | Customer schedules a pickup in the app |
| Picked up | Driver marks pickup done (photo) |
| At shop / linked | Staff mark in at the counter in Smart; the sync agent sees the new ticket for that customer (phone match + date) and links it, or staff confirm the link in the dashboard |
| Ready | Invoice scanned at "ready" and conveyor slot entered at the same moment (confirmed by owner), so `CONV1` set = ready |
| Out for delivery | Driver scans the invoice when loading the van |
| Delivered | Driver scans or taps at the door, with a photo |
| Closed | Staff charge out in Smart (possibly Smart's "delivered batch charge out"); the sync agent sees `PICKUP = 'Y'` |

Customer texts: picked up → ready → driver on the way → delivered.

## Payments
- Customers save a card in the app (Stripe). Charge when the order is delivered, or prepay.
- Staff record the payment in Smart as a card / prepaid payment, so Smart's balances stay correct.
- Daily reconciliation report: Stripe total vs. what was recorded in Smart.

## Security
- Sync agent: read-only DB access, outbound HTTPS only (no open ports on the shop network), API key per device.
- Customer data in the cloud: only what delivery needs (name, phone, address, ticket summary).
- No card numbers stored anywhere in the app; Stripe holds them.

## Build phases
1. **Sync agent v0:** read open tickets + customers, push to a test database. Prove it's reliable for 1–2 weeks. ✅ built + E2E-proven (2026-11-12).
2. **Staff dashboard:** see tickets, create delivery requests by phone on behalf of customers, link tickets. ← **next (Phase 2, in `apps/web`)**
3. **Driver page (browser-first):** route list, invoice scanning, delivered photo.
4. **Customer app + texts:** schedule pickups, status updates. (Public `/` homepage ships here or earlier as the shell.)
5. **Payments in the app** (Stripe) + reconciliation.
6. Optional: limited writes back to Smart (customer address / notes).

## Invoice barcode (verified 2026-11-11)
- Printed on the invoice by the TM-T20II. Symbology **Code 39**.
- Encodes the **6-digit invoice number only** (e.g. `810040`), which equals `INV.INVNUM` exactly. Recent `INVNUM` values are all 6 digits.
- An "L" printed before the number on laundry-only tickets is **not** in the barcode.
- Phone browsers can read Code 39 (BarcodeDetector `code_39`, or ZXing), so the driver page can scan invoices with the phone camera — this is what makes the browser-first driver MVP viable.
- `INV.CONV1` holds the conveyor slot (e.g. `501`, `610`, sometimes text such as `back`). Confirmed by owner (2026-11-11): the slot is entered when the invoice is scanned as ready, so slot set = order ready.

## Shop facts (owner, 2026-11-11)
- Smart's data folder on the Main PC is probably `C:\Smart` (confirm at first install).
- The Main PC is on only during business hours (Mon–Sat ~7:00–19:30), off overnight. Full reconcile runs at agent startup, with a daily fallback; health alerts are suppressed outside business hours.
- Admin rights are available to install the agent as a Windows service.
- Shop marketing site: `greencleanerspro.com`, repo `Nick-Bae/greencleaners` (single static HTML page). Being folded into `apps/web` as `/`.

## Open questions
- Will the shop use its own driver, or a courier service?
- Delivery area and fees?
