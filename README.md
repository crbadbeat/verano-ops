# Verano OPS

Operations hub for Verano Outdoor Living: the order book, scheduling, inventory,
manufacturing, transfers and glass. Standalone (no ERP dependency).

## Workflow

1. **Enter the order** — upload the signed Final Sales Agreement, paste the saved
   configurator link, or build it by hand (`/orders`).
2. **Seed inventory** — upload a spreadsheet of SKU + on-hand counts (`/admin/data`).
3. **Schedule** the confirmed order onto a delivery trip on the calendar
   (`/scheduling`).
4. **Pick & stage** — the warehouse scans items out of their bins onto a staging
   lane the day before load (`/staging`).
5. **QC then dispatch** — a manager QCs the staged trip (`/qc`); the driver
   inspects and signs off (`/dispatch`), which relieves inventory via the audit
   ledger.

## Orders

An order carries the **configuration**; the SKUs are composed from it, never
re-inferred. Two inputs decode to the same thing:

- **The agreement PDF** — read positionally (the x coordinate is what carries the
  meaning), giving the customer, the money, the order number and every item.
- **The configurator link** — its option tables were recovered from the
  configurator's own bundle and live in `lib/configurator-catalogue.ts`.

Both produce a `ParsedOrder`; `lib/order-derive.ts` turns that into island
configurations and calls `composeSku()`. A GX10 double with two cocktail stations
beside a Maui 10 becomes `GX10-D-NN-2-1-1-0-N-N-N-CA` + `VOLGX10DNNNNN` and
`MA10-N-NN-0-2-0-0-L-Y-Y-CA` + `VOLMA10NNNNNN`, with the pick list to match.

- A configuration nobody has stocked gets a product created for it, left unlinked
  so it shows up in the **NetSuite match queue** (`/inventory/netsuite-queue`).
- A top that has to be cut records the blank it would come from and shows whether
  one is on hand (`/glass/demand`). **No waterjet job is raised** — a blank is
  fungible and customers often buy months ahead, so glass is only cut once the
  customer is scheduled.
- An **addendum** is a re-uploaded PDF: the configuration is rebuilt from it and
  lines added by hand are kept. Every change is logged with who and when.
- Anything that cannot be matched to a product is listed for someone to map once;
  the mapping is remembered in `PickAlias`, the hub-native scan-alias table that
  every free-text line (orders, transfers, returns) learns from.

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind v4 — one deploy for the UI and
  its server actions.
- **Postgres** (Supabase) + **Prisma 6** — product master, scan-alias map, and the
  append-only inventory ledger.
- **Auth**: email/password, bcrypt-hashed, signed-JWT session cookie (`jose`). Routes are
  gated by `proxy.ts`.
- **NetSuite** (optional): a nightly SuiteQL/REST sync refreshes standard cost and item
  descriptions (`/api/sync/netsuite`); no ODBC/JDBC driver, so it fits the serverless host.

## Key design decisions

- **On-hand is never a stored counter.** It's `SUM(qtyDelta)` over `InventoryLedger`.
  Seed, adjustment, pick, shipment, and reversal are all rows — every number is explainable
  and every movement is reversible.
- **An order stores the configuration, not just the SKUs.** The SKUs are composed
  from it, so an order explains itself and an addendum re-derives cleanly.
- **Taking an order moves no stock.** Nothing is picked, built or cut until the
  work actually happens.
- **Picking moves stock bin → lane; depletion happens at driver sign-off.** Staging is a
  status milestone that keeps goods conserved inside the warehouse; the negative `SHIPMENT`
  is written out of the lane when the driver signs off, so on-hand stays live and auditable.
- **The stable NetSuite item number is the identity anchor.** Free-text item names drift, so
  scanned or free-text lines resolve to a `Product` through the `PickAlias` scan-alias table
  (extendable by mapping unmatched items in the UI).

## Setup

### 1. Database (Supabase)

Create a Supabase project, then put both connection strings in `.env`
(see `.env.example`): pooled `DATABASE_URL` (port 6543) for the app, direct `DIRECT_URL`
(port 5432) for migrations.

```bash
npm install
npm run db:migrate      # applies prisma/migrations to your database
```

For a quick local Postgres instead, point `DATABASE_URL`/`DIRECT_URL` at it and run
`npm run db:push`.

### 2. Session secret

```bash
# .env
SESSION_SECRET="<32+ random chars>"   # openssl rand -base64 32
```

### 3. NetSuite sync (optional)

Set the `NETSUITE_*` and `CRON_SECRET` variables (see `.env.example`) to enable the nightly
cost + description refresh. Leave them blank to disable it — the route then reports
"not configured" and changes nothing.

### 4. Run

```bash
npm run dev        # http://localhost:3000
```

Admin accounts are created and invited from `/admin/users`; the first account you create
becomes the admin.

## Spreadsheet formats

**Seed inventory** — columns (case-insensitive): `SKU` (NetSuite name) + `Qty`
(or `On Hand`/`Quantity`). Optional: `Name`, `Category`.

**Item master** — keyed on the stable `NetSuite Number`; see `/admin/data` for the full
column list. Scan aliases are added per item on the item-detail page, not by upload.

### QR scanning

Uses the native `BarcodeDetector` API where available (Chrome/Android) and falls back to
`jsQR` (canvas-based) everywhere else, including iOS Safari. Note: camera access requires a
secure context — `https` in production, or `localhost` in dev.
