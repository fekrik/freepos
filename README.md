# FreshPOS

Cloud point of sale for grocery stores and supermarkets (US, EBT-ready).

## Layout
| Path | What |
|---|---|
| `packages/shared` | Domain core shared by lane + server: money, barcodes (UPC/PLU/deli), cart totals, SNAP tax rules, RBAC |
| `apps/api` | NestJS + Prisma + PostgreSQL REST API (multi-tenant) |
| `apps/web` | React PWA: checkout lane (`/lane`) and back office (`/admin`) |
| `_archive` | Previous Odoo prototype (kept for reference) |

## Run locally
Requires Node 20+. No Postgres install needed: `db:local` runs a real Postgres 16 from npm binaries.

```bash
npm install
npm run build -w @freshpos/shared
cp apps/api/.env.example apps/api/.env

# terminal 1: local database
npm run db:local -w @freshpos/api
# terminal 2: schema + demo data, then API
npm run db:migrate -- --name init && npm run db:seed && npm run dev:api
# terminal 3: web
npm run dev:web
```

Open http://localhost:5173
- **Checkout Lane:** Company ID `demo` → Select "Main Street Supermarket" → Employee `3000`, PIN `3000` (Cashier Casey). Supervisor PIN: `2000`, Admin PIN: `1000`.
- **Back Office Admin:** http://localhost:5173/admin/login → `admin@demo.com` / `admin123`.

## Database
FreshPOS uses **PostgreSQL 16** with **Prisma ORM**.
- All entities (`Tenant`, `Store`, `Register`, `User`, `Department`, `TaxClass`, `Product`, `Barcode`, `StorePrice`, `Inventory`, `AuditLog`) are modeled in [apps/api/prisma/schema.prisma](file:///Users/fekri/pos_demo/apps/api/prisma/schema.prisma).
- In local development, `npm run db:local -w @freshpos/api` boots an embedded PostgreSQL 16 server in `.pgdata` (no external installation required).
- In production, configure `DATABASE_URL` to point to any managed PostgreSQL instance (e.g., Neon).

## Demo Supermarket Catalog
The database is seeded with **58 supermarket items** across 11 departments:
- **Produce (PLU weighed & each):** Bananas (`4011`), Honeycrisp Apples (`3283`), Gala Apples (`4133`), Avocados (`4046`), Roma Tomatoes (`4087`), Broccoli (`3082`), Strawberries (`070000000100`).
- **Dairy & Eggs:** Whole Milk (`070000000010`), 2% Milk (`070000000126`), Oat Milk, Large Eggs (`070000000027`), Pasture-Raised Organic Eggs, Butter, Greek Yogurt, Cheddar & Mozzarella.
- **Bakery:** Sourdough Boule (`070000000034`), Whole Wheat Bread, Butter Croissants, Bagels.
- **Meat, Seafood & Deli:** Deli Roasted Turkey (`12345` PLU or embedded barcode `212345005996`), Deli Roast Beef, Chicken Breasts, Ground Beef, Salmon Fillet, Bacon.
- **Beverages:** Classic Cola 12pk (`070000000041`), Diet Cola, Mineral Water, Orange Juice, Cold Brew.
- **Pantry & Grocery:** Olive Oil, Jasmine Rice, Spaghetti, Marinara Sauce, Peanut Butter, Jam.
- **Snacks & Candy:** Potato Chips, Tortilla Chips, Roasted Almonds, Dark Chocolate.
- **Frozen:** Four Cheese Pizza, Ice Cream, Frozen Berries.
- **Household & Paper:** Paper Towels (`070000000058`), Bath Tissue, Dish Soap, Tide Pods.
- **Beer & Wine (21+ age check):** Sierra Nevada IPA (`070000000065`), Stella Artois Lager, Josh Cabernet, Kim Crawford Sauvignon Blanc, White Claw 12pk.

## Free Production Hosting
FreshPOS is configured as a **single unified service** (the backend serves both the REST API and the React SPA), connected to your permanent Neon database:

| Component | Provider | Details |
|---|---|---|
| **Database** | **[Neon](https://neon.tech)** | Serverless PostgreSQL (0.5 GB, autoscaling, never expires or auto-deletes). |
| **All-in-One Web App** | **[Render](https://render.com)** | Free Web Service running `freshpos` (both React UI + NestJS API at a single URL). Blueprint provided in `render.yaml`. |

### Quick Deploy to Render:
1. Push this repository to GitHub.
2. In [Render](https://dashboard.render.com), click **New +** → **Blueprint** and select your repo (uses `render.yaml`).
3. Set the `DATABASE_URL` and `DATABASE_URL_UNPOOLED` environment variables to your Neon connection strings.
4. Render builds and launches your public POS app at `https://freshpos.onrender.com`!

## Features (Phase 1, 2 & 3 Complete)
- **Multi-Tender Payments:**
  - 💵 **Cash:** Fast bill buttons ($5, $10, $20, $50, $100, exact), custom cash keypad, automatic live change calculation.
  - 💳 **Stripe Terminal Card:** Simulated reader interaction with authorization flow (Tap / Chip / Swipe).
  - 🍎 **EBT SNAP:** Capped at eligible grocery subtotal, PIN pad entry, and automatic federal tax forgiveness (7 CFR 272.1).
  - 🔀 **Split Tender:** Seamlessly divide payments across multiple methods (e.g. pay $10 with SNAP and remainder with Cash or Card).
- **Supervisor Overrides (Audited Exceptions):**
  - 🏷️ **Price Override:** Adjust line unit price (e.g. damaged goods, competitor match, shelf tag dispute).
  - ✂️ **Line Discount:** Apply percentage (10%, 15%, 20%, 50%) or fixed dollar discounts.
  - 🚫 **Void Ticket Approval:** Prevent cashiers from clearing scanned orders without supervisor authentication (loss-prevention sweethearting safeguard).
  - 🔒 **PIN-gated Security:** Requires supervisor PIN (`2000` or `1000`) and mandatory reason code.
  - 📜 **Full Audit Logging:** Immutable log entry in PostgreSQL recording cashier, approving supervisor, previous price, new price, and reason.
- **Promotions & Customer Loyalty:**
  - 👤 **Loyalty Lookup & Accrual:** Customer lookup by phone number (Demo: `555-0101` Sarah Connor, `555-0102` David Miller). Real-time point accrual (1 point per whole dollar).
  - 🏷️ **Automatic Multi-Buy Deals:**
    - Hass Avocados: 2 for $2.00 (regular $1.29 each).
    - Classic Cola 12pk: 3 for $18.00 (regular $7.49 each).
    - Artisan Sourdough: Buy 2 Get 1 Free.
- **Cash Drawer Shifts & Official Z-Reports:**
  - 🔓 **No-Sale Drawer Kick:** Audited drawer open to make change or replace receipt paper.
  - 🏦 **Safe Drop:** Skim excess cash into the store safe to reduce robbery exposure.
  - 🧾 **Paid-Out (Petty Cash):** Track cash paid out for store supplies or deliveries with payee and description.
  - 📊 **Blind Cash Count & Z-Report:** Cashier enters physical cash counted in drawer; system computes expected cash, actual counted cash, and over/short variance with itemized tender breakdown.
- **Returns & Refunds (Supermarket Grocery Exceptions):**
  - 🔍 **Receipt Lookup:** Instant lookup by barcode scan, `TX-...` sale number, or 1-click recent receipts list.
  - 📦 **Itemized Line Returns:** Select specific items and partial quantities to return.
  - 🔄 **Restock vs. 🗑️ Spoilage Write-Off:** Perishables/damaged goods are flagged as spoilage write-off (does not increment saleable inventory), while sealed items are restocked to shelf (`onHand` incremented).
  - 🍎 **SNAP Compliance (7 CFR 272.1):** Enforces federal rule preventing SNAP-purchased groceries from being refunded in cash.
  - 💵 **Cash Drawer Reversal:** Cash refunds automatically record a `paid_out` drawer movement, keeping shift reconciliation balanced.
  - 🔒 **Supervisor Authorization:** Requires supervisor approval PIN (`2000` / `1000`) for cashier return processing.
  - 🧾 **Official Return Receipts:** Generates itemized `REF-...` receipts and append-only audit log records.
- **Thermal Receipts:**
  - Itemized receipt layout with print styles (`window.print()`).
  - Store info, USDA FNS retailer number, line item weights, loyalty balance, override reason badges, tax flags, SNAP breakdowns, and payment records.
- **Customer-Facing Display (CFD / Pole Display at `/cfd`):**
  - 🖥️ **Live Real-Time Synchronization:** Zero-latency peer broadcast via `BroadcastChannel` and `StorageEvent` across monitors/tabs.
  - 🛒 **Itemized Cart & Hero Spotlight:** Shoppers view scanned items, weights, prices, savings, and an animated "Just Scanned" hero card.
  - 🥑 **Idle Welcome & Deals Carousel:** Displays store specials (Avocados 2 for $2, Cola 3 for $18, Sourdough BOGO), digital clock, and payment badges when lane is idle.
  - 💳 **Payment & Thank You Screens:** Displays live tender prompts, change due, and rewards points earned.
  - 🪟 **One-Click Pop-Out:** Cashiers can launch `/cfd` into a secondary monitor or tablet via the `🖥️ Customer Screen` button.
- **Offline Resilience:**
  - IndexedDB storage queues completed transactions locally if network drops.
  - Automatic background synchronization as soon as connection is restored.
- **Back Office & Bulk Product Ingestion:**
  - 📥 **Bulk CSV / Spreadsheet Import:** Ingest large catalogs from food distributors (UNFI, KeHE, McLane, Sysco, C&S) or Excel/Google Sheets.
    - Upload `.csv` files or paste directly from clipboard.
    - Intelligent column normalization (detects `Name`/`Description`, `Price`/`MSRP`, `UPC`/`Barcode`, `SoldBy`, `SNAP`, `TaxClass`).
    - Live interactive preview table showing verified prices, departments, barcodes, and flags before committing.
    - Automatic upsert: updates existing items matching normalized GTIN or PLU without creating duplicates, and creates new items.
    - 📄 **1-Click CSV Template Download:** Download ready-to-fill supermarket template directly from the modal.
  - 📦 **Catalog & Inventory Management:** Manage products, department mappings, tax classes, bottle deposits, age restrictions, and multiple barcodes.
  - 📜 **Full Audit Logging:** Real-time append-only audit trail in PostgreSQL for sensitive actions (price overrides, returns, voids, drawer opens, and bulk imports).
  - 🧾 **Transactions Log:** Complete sales ledger with line-item and receipt inspection.

## Tests
```bash
npm test
```


