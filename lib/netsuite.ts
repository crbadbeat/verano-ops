import { createHmac, randomBytes } from "node:crypto";

// -----------------------------------------------------------------------------
// NetSuite SuiteQL-over-REST client. A direct integration — no external BI layer
// in between. This talks straight to NetSuite's REST query endpoint with OAuth
// 1.0a token-based auth (TBA), which needs no
// ODBC/JDBC driver and fits the serverless hub. It returns plain rows; the
// caller (the nightly sync route) upserts them into Product.
//
// No @/lib/db import here on purpose: the pure helpers below are unit-tested,
// and Vitest cannot import anything that reaches the Prisma client.
// -----------------------------------------------------------------------------

export interface NetsuiteConfig {
  accountId: string; // e.g. "1234567" or "1234567_SB1" (sandbox)
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

/** Read NetSuite TBA credentials from the environment; null if not set up. */
export function netsuiteConfig(): NetsuiteConfig | null {
  const accountId = process.env.NETSUITE_ACCOUNT_ID;
  const consumerKey = process.env.NETSUITE_CONSUMER_KEY;
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET;
  const tokenId = process.env.NETSUITE_TOKEN_ID;
  const tokenSecret = process.env.NETSUITE_TOKEN_SECRET;
  if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
    return null;
  }
  return { accountId, consumerKey, consumerSecret, tokenId, tokenSecret };
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** The REST host for an account id (sandbox "_SB1" -> "-sb1", lower-cased). */
export function netsuiteHost(accountId: string): string {
  const slug = accountId.toLowerCase().replace(/_/g, "-");
  return `https://${slug}.suitetalk.api.netsuite.com`;
}

/** The OAuth 1.0a signature base string: METHOD & url & sorted-encoded-params. */
export function oauthBaseString(
  method: string,
  baseUrl: string,
  params: Record<string, string>
): string {
  const encoded = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  return `${method.toUpperCase()}&${percentEncode(baseUrl)}&${percentEncode(encoded)}`;
}

/** Build the OAuth 1.0a (HMAC-SHA256) Authorization header for a request. */
export function authorizationHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  config: NetsuiteConfig,
  nonce: string,
  timestamp: string
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_token: config.tokenId,
    oauth_version: "1.0",
  };
  const base = oauthBaseString(method, baseUrl, { ...queryParams, ...oauth });
  const signingKey = `${percentEncode(config.consumerSecret)}&${percentEncode(config.tokenSecret)}`;
  const signature = createHmac("sha256", signingKey).update(base).digest("base64");

  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  const parts = Object.keys(header)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(header[k])}"`);
  // NetSuite requires the account id as the OAuth realm.
  return `OAuth realm="${config.accountId}", ${parts.join(", ")}`;
}

export interface NetsuiteItem {
  netsuiteNumber: string; // NetSuite internal id — the stable identity anchor
  name: string;
  description: string | null;
  barcode: string | null;
  standardCostCents: number | null;
  itemType: string; // SuiteQL item.itemtype code, e.g. InvtPart / NonInvtPart / Assembly / Kit
}

// NetSuite item.itemtype codes we let the sync CREATE as new products: purchased,
// stocked goods (appliances, accessories, raw, glass blanks). Assembly/Kit are
// deliberately excluded from creation — that is how configured Bases/Tops appear,
// and those must keep the smart-SKU identity they are born with at order intake
// (netsuiteNumber is null until a human matches them in the queue). Existing
// linked Assembly/Kit products are still UPDATED by number; they just are not
// auto-created here. Case-insensitive to survive account-specific casing.
const CREATABLE_ITEM_TYPES = new Set(["invtpart", "noninvtpart"]);

/** Whether the sync may create a brand-new product for this NetSuite item type. */
export function isCreatableItemType(itemType: string): boolean {
  return CREATABLE_ITEM_TYPES.has(itemType.trim().toLowerCase());
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Parse a NetSuite cost (dollars, number or string) into integer cents. */
export function centsFromCost(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Map one SuiteQL `item` row to a normalized record; null if it has no id. */
export function mapItemRow(row: Record<string, unknown>): NetsuiteItem | null {
  const id = str(row.id) || str(row.internalid);
  if (!id) return null;
  return {
    netsuiteNumber: id,
    name: str(row.displayname) || str(row.itemid) || id,
    description: str(row.description) || str(row.purchasedescription) || null,
    barcode: str(row.upccode) || null,
    // Average cost is the valuation basis; fall back to purchase price only when
    // an item has no average cost yet (e.g. never stocked).
    standardCostCents: centsFromCost(row.averagecost) ?? centsFromCost(row.cost),
    itemType: str(row.itemtype),
  };
}

// The SuiteQL that pulls the item master + cost. `id` is the stable internal
// number we anchor on. `averagecost` is what we value inventory at (the business
// looks at average cost, not purchase price); `cost` (purchase price) is only a
// fallback for items that have no average cost yet. NB: the item table has
// `description`/`purchasedescription` — there is no `salesdescription`.
//
// `itemtype` drives create-eligibility (see isCreatableItemType). The WHERE keeps
// only real stocked/sellable items — excluding Payment/Discount/Subtotal/Tax/Ship/
// Service and other non-inventory transaction lines — so neither the update nor
// the create pass ever sees junk rows.
export const ITEM_SUITEQL =
  "SELECT id, itemid, displayname, description, purchasedescription, upccode, averagecost, cost, itemtype " +
  "FROM item WHERE isinactive = 'F' " +
  "AND itemtype IN ('InvtPart', 'NonInvtPart', 'Assembly', 'Kit')";

/** Thrown when the sync runs without NetSuite credentials configured. */
export class NetsuiteNotConfiguredError extends Error {
  constructor() {
    super("NetSuite credentials are not configured (set NETSUITE_* env vars).");
    this.name = "NetsuiteNotConfiguredError";
  }
}

/**
 * Run one SuiteQL statement over the REST query endpoint, paginating until
 * NetSuite reports no more rows, and return the raw rows. The single place the
 * POST + OAuth + `?limit/offset` + `Prefer: transient` boilerplate lives — every
 * fetcher (items, per-location cost, orders) maps over what this returns.
 *
 * `limit/offset` go in the query string AND are signed as OAuth params (they are
 * part of the request URL). `label` only tags the error message so a failure
 * says which query blew up.
 */
export async function runSuiteQL(
  q: string,
  config: NetsuiteConfig | null = netsuiteConfig(),
  label = "SuiteQL"
): Promise<Record<string, unknown>[]> {
  if (!config) throw new NetsuiteNotConfiguredError();

  const baseUrl = `${netsuiteHost(config.accountId)}/services/rest/query/v1/suiteql`;
  const rows: Record<string, unknown>[] = [];
  const limit = 1000;
  let offset = 0;

  // Hard ceiling so a bad `hasMore` can never loop forever.
  for (let page = 0; page < 200; page++) {
    const query = { limit: String(limit), offset: String(offset) };
    const nonce = randomBytes(16).toString("hex");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const auth = authorizationHeader("POST", baseUrl, query, config, nonce, timestamp);

    const res = await fetch(`${baseUrl}?limit=${limit}&offset=${offset}`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        Prefer: "transient",
      },
      body: JSON.stringify({ q }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`NetSuite ${label} ${res.status}: ${body}`.slice(0, 300));
    }
    const json = (await res.json()) as { items?: Record<string, unknown>[]; hasMore?: boolean };
    for (const row of json.items ?? []) rows.push(row);
    if (!json.hasMore) break;
    offset += limit;
  }

  return rows;
}

/**
 * Fetch the full item master via SuiteQL. Returns normalized records for the
 * caller to upsert.
 */
export async function fetchNetsuiteItems(
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<NetsuiteItem[]> {
  const rows = await runSuiteQL(ITEM_SUITEQL, config, "item SuiteQL");
  const items: NetsuiteItem[] = [];
  for (const row of rows) {
    const mapped = mapItemRow(row);
    if (mapped) items.push(mapped);
  }
  return items;
}

export interface NetsuiteLocationCost {
  netsuiteNumber: string; // item internal id (matches Product.netsuiteNumber)
  netsuiteLocationId: number; // location internal id (matches Location.netsuiteId)
  averageCostCents: number | null;
}

/** Map one `inventoryitemlocations` row to a normalized per-location cost. */
export function mapLocationCostRow(row: Record<string, unknown>): NetsuiteLocationCost | null {
  const item = str(row.item);
  const location = str(row.location);
  const locId = Number(location);
  if (!item || !location || !Number.isInteger(locId)) return null;
  return {
    netsuiteNumber: item,
    netsuiteLocationId: locId,
    averageCostCents: centsFromCost(row.averagecostmli), // MLI = multi-location inventory
  };
}

/**
 * Fetch NetSuite's per-location average cost, but ONLY for the given location ids
 * — the warehouses the WMS actually mirrors. Filtering in the query keeps this
 * cheap: without it the table is items × all ~90 locations. Empty list -> no call.
 * Paginated like fetchNetsuiteItems.
 */
export async function fetchNetsuiteLocationCosts(
  locationIds: number[],
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<NetsuiteLocationCost[]> {
  if (!config) throw new NetsuiteNotConfiguredError();
  const ids = [...new Set(locationIds)].filter((n) => Number.isInteger(n));
  if (ids.length === 0) return [];

  // ids are integers from our own DB, not user input — safe to inline. Only pull
  // rows with stock on hand: inventoryitemlocations carries a row for every item
  // ever configured at a location (~hundreds each), so without this filter the
  // scan is items × locations and blows the serverless time budget. We value the
  // WMS's own on-hand, so an item with zero NetSuite on-hand needs no per-location
  // cost here (it falls back to the account-wide average).
  const q = `SELECT item, location, averagecostmli FROM inventoryitemlocations WHERE location IN (${ids.join(",")}) AND quantityonhand <> 0`;
  const rows = await runSuiteQL(q, config, "location cost");
  const out: NetsuiteLocationCost[] = [];
  for (const row of rows) {
    const mapped = mapLocationCostRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Order pull (sales orders). The raw SuiteQL side lives here; the pure mapping to
// the WMS order shape is in lib/netsuite-orders.ts, and the DB upsert in the sync
// route. See the netsuite-orders-sync memo for the discovered transaction shape.
// -----------------------------------------------------------------------------

/** WMS-synced subsidiaries: 2 = PGD (showroom), 3 = PGI (direct). */
export const SYNCED_SUBSIDIARY_IDS = [2, 3];

// Open sales-order statuses we pull. Excludes Cancelled (C), fully Billed (G) and
// Closed (H) so the working set stays bounded — the review queue + incremental
// watermark do the rest. A=Pending Approval, B=Pending Fulfillment,
// D=Partially Fulfilled, E=Partially Fulfilled/Pending Billing, F=Pending Billing.
const OPEN_SO_STATUSES = ["A", "B", "D", "E", "F"];

export interface NetsuiteOrderRaw {
  header: Record<string, unknown>;
  lines: Record<string, unknown>[];
}

// The header columns pulled for every order (shared by the batch pull and the
// single-order re-sync).
const ORDER_HEADER_COLUMNS =
  "t.id, t.tranid, t.trandate, t.lastmodifieddate, t.entity, t.status, " +
  "t.total, t.foreigntotal, t.custbody_total_deposit_paid, t.employee, t.cseg_sales_center, " +
  "t.custbody_header_sales_center_select, " +
  "t.custbody_pg_sales_rep_1, t.custbody_pg_sales_rep_2, t.custbody_pg_gtl, " +
  "t.custbody_pg_vp, t.custbody_pg_regional, " +
  // NB: `billaddress` (billing text) is NOT a valid transaction column in SuiteQL
  // — billing address text needs a separate lookup (deferred). `billingaddress`
  // is the address-record id.
  "t.shipaddress, t.billingaddress, t.shippingaddress, t.intercompany";

/** SuiteQL for sales-order headers. subsidiary is on the LINES, so filter with an
 *  EXISTS; `sinceDate` (YYYY-MM-DD) makes the pull incremental on lastmodifieddate. */
export function ordersHeaderQuery(opts: { subsidiaryIds: number[]; sinceDate?: string | null }): string {
  const subs = opts.subsidiaryIds.filter((n) => Number.isInteger(n)).join(",");
  const statuses = OPEN_SO_STATUSES.map((s) => `'${s}'`).join(",");
  const since =
    opts.sinceDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.sinceDate)
      ? ` AND t.lastmodifieddate >= TO_DATE('${opts.sinceDate}', 'YYYY-MM-DD')`
      : "";
  return (
    `SELECT ${ORDER_HEADER_COLUMNS} ` +
    "FROM transaction t WHERE t.type = 'SalesOrd' AND t.intercompany = 'F' " +
    `AND t.status IN (${statuses}) ` +
    `AND EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction = t.id AND tl.subsidiary IN (${subs}))` +
    // Exclude the intercompany fulfillment orders (customer "PGD I/C Customer for
    // PGS" = entity 4148, and the "(PGS)"-suffixed duplicate customers) — those are
    // the PGD→PGI drop-ship chain, not real customer orders, so they don't belong
    // in this app.
    " AND NOT EXISTS (SELECT 1 FROM customer c WHERE c.id = t.entity AND " +
    "(UPPER(c.entityid) LIKE '%I/C%' OR UPPER(c.entityid) LIKE '%(PGS)%'))" +
    since
  );
}

/** Fetch a single order (header + lines) by its transaction internal id, for the
 *  on-demand "Sync from NetSuite" button. No status filter — pulls it as-is. */
export async function fetchNetsuiteOrderByTransactionId(
  txId: string,
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<NetsuiteOrderRaw | null> {
  if (!config) throw new NetsuiteNotConfiguredError();
  if (!/^\d+$/.test(txId)) return null;
  const headers = await runSuiteQL(
    `SELECT ${ORDER_HEADER_COLUMNS} FROM transaction t WHERE t.id = ${txId}`,
    config,
    "single order"
  );
  if (headers.length === 0) return null;
  const lines = await runSuiteQL(orderLinesQuery([txId]), config, "single order lines");
  return { header: headers[0], lines };
}

export interface NetsuiteSalesCenter {
  id: number; // cseg_sales_center segment internal id
  name: string; // e.g. "Fort Myers Showroom"
}

/**
 * Fetch the distinct sales centers (selling showrooms) seen on sales orders. The
 * custom-segment record table isn't queryable, so we read the display value with
 * BUILTIN.DF over a bounded sample of recent orders and dedupe — the ~50 active
 * centers all appear within a few thousand rows.
 */
export async function fetchSalesCenters(
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<NetsuiteSalesCenter[]> {
  if (!config) throw new NetsuiteNotConfiguredError();
  const rows = await runSuiteQL(
    "SELECT cseg_sales_center AS id, BUILTIN.DF(cseg_sales_center) AS name " +
      "FROM transaction WHERE type = 'SalesOrd' AND intercompany = 'F' " +
      "AND cseg_sales_center IS NOT NULL AND ROWNUM <= 8000",
    config,
    "sales centers"
  );
  const byId = new Map<number, string>();
  for (const r of rows) {
    const id = Number(r.id);
    const name = str(r.name);
    if (Number.isInteger(id) && name) byId.set(id, name);
  }
  return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch the sales-center id for specific sales orders, by transaction internal id. */
export async function fetchOrderSalesCenters(
  txIds: string[],
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(txIds.filter((s) => /^\d+$/.test(s)))];
  if (ids.length === 0 || !config) return out;
  const CH = 500;
  for (let i = 0; i < ids.length; i += CH) {
    const rows = await runSuiteQL(
      `SELECT id, cseg_sales_center AS sc FROM transaction WHERE id IN (${ids.slice(i, i + CH).join(",")}) AND cseg_sales_center IS NOT NULL`,
      config,
      "order sales centers"
    );
    for (const r of rows) {
      const id = str(r.id);
      const sc = Number(r.sc);
      if (id && Number.isInteger(sc)) out.set(id, sc);
    }
  }
  return out;
}

/** Fetch NetSuite item display names for the given item internal ids (chunked). */
export async function fetchItemNames(
  itemIds: string[],
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(itemIds.filter((s) => /^\d+$/.test(s)))];
  if (ids.length === 0 || !config) return out;
  const CH = 500;
  for (let i = 0; i < ids.length; i += CH) {
    const rows = await runSuiteQL(
      `SELECT id, itemid, displayname FROM item WHERE id IN (${ids.slice(i, i + CH).join(",")})`,
      config,
      "item names"
    );
    for (const r of rows) {
      const id = String(r.id ?? "").trim();
      const nm = String(r.displayname ?? "").trim() || String(r.itemid ?? "").trim();
      if (id && nm) out.set(id, nm);
    }
  }
  return out;
}

/** SuiteQL for the lines of the given transaction internal ids. */
export function orderLinesQuery(txIds: string[]): string {
  const ids = txIds.filter((s) => /^\d+$/.test(s)).join(",");
  return (
    "SELECT transaction, id, uniquekey, item, itemtype, quantity, rate, netamount, " +
    "location, subsidiary, mainline, taxline, kitmemberof, memo " +
    `FROM transactionline WHERE transaction IN (${ids})`
  );
}

/** Header query for the HISTORICAL/analytics pull: a full calendar year, ALL
 *  statuses except Cancelled (billed/closed sales), by trandate. `limit` caps the
 *  rows (ROWNUM) for a sample run. */
export function ordersHeaderQueryHistorical(opts: {
  subsidiaryIds: number[];
  year: number;
  limit?: number;
}): string {
  const subs = opts.subsidiaryIds.filter((n) => Number.isInteger(n)).join(",");
  const from = `${opts.year}-01-01`;
  const to = `${opts.year + 1}-01-01`;
  const limit = opts.limit && opts.limit > 0 ? ` AND ROWNUM <= ${Math.floor(opts.limit)}` : "";
  return (
    `SELECT ${ORDER_HEADER_COLUMNS} ` +
    "FROM transaction t WHERE t.type = 'SalesOrd' AND t.intercompany = 'F' AND t.status != 'C' " +
    `AND t.trandate >= TO_DATE('${from}', 'YYYY-MM-DD') AND t.trandate < TO_DATE('${to}', 'YYYY-MM-DD') ` +
    `AND EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction = t.id AND tl.subsidiary IN (${subs})) ` +
    "AND NOT EXISTS (SELECT 1 FROM customer c WHERE c.id = t.entity AND " +
    "(UPPER(c.entityid) LIKE '%I/C%' OR UPPER(c.entityid) LIKE '%(PGS)%'))" +
    limit
  );
}

/** Fetch a year of historical sales orders (header + lines), for the analytics
 *  backfill. Same line-grouping as fetchNetsuiteOrders. */
export async function fetchNetsuiteOrdersHistorical(
  opts: { subsidiaryIds?: number[]; year: number; limit?: number },
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<NetsuiteOrderRaw[]> {
  if (!config) throw new NetsuiteNotConfiguredError();
  const subsidiaryIds = opts.subsidiaryIds ?? SYNCED_SUBSIDIARY_IDS;
  const headers = await runSuiteQL(
    ordersHeaderQueryHistorical({ subsidiaryIds, year: opts.year, limit: opts.limit }),
    config,
    "historical orders header"
  );
  const ids = headers.map((h) => String(h.id ?? "")).filter((s) => /^\d+$/.test(s));
  if (ids.length === 0) return [];
  const CHUNK = 200;
  const linesByTx = new Map<string, Record<string, unknown>[]>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await runSuiteQL(orderLinesQuery(ids.slice(i, i + CHUNK)), config, "historical orders lines");
    for (const r of rows) {
      const t = String(r.transaction ?? "");
      const arr = linesByTx.get(t);
      if (arr) arr.push(r);
      else linesByTx.set(t, [r]);
    }
  }
  return headers.map((h) => ({ header: h, lines: linesByTx.get(String(h.id)) ?? [] }));
}

/**
 * Fetch sales-order headers (filtered to the synced subsidiaries + open statuses,
 * optionally incremental) and their lines, grouped per order. Line fetches are
 * chunked to keep the IN(...) list bounded.
 */
export async function fetchNetsuiteOrders(
  opts: { subsidiaryIds?: number[]; sinceDate?: string | null } = {},
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<NetsuiteOrderRaw[]> {
  if (!config) throw new NetsuiteNotConfiguredError();
  const subsidiaryIds = opts.subsidiaryIds ?? SYNCED_SUBSIDIARY_IDS;

  const headers = await runSuiteQL(
    ordersHeaderQuery({ subsidiaryIds, sinceDate: opts.sinceDate }),
    config,
    "orders header"
  );
  const ids = headers.map((h) => String(h.id ?? "")).filter((s) => /^\d+$/.test(s));
  if (ids.length === 0) return [];

  const CHUNK = 200;
  const linesByTx = new Map<string, Record<string, unknown>[]>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await runSuiteQL(orderLinesQuery(ids.slice(i, i + CHUNK)), config, "orders lines");
    for (const r of rows) {
      const t = String(r.transaction ?? "");
      const arr = linesByTx.get(t);
      if (arr) arr.push(r);
      else linesByTx.set(t, [r]);
    }
  }

  return headers.map((h) => ({ header: h, lines: linesByTx.get(String(h.id)) ?? [] }));
}

/**
 * Per-customer deposit context for attributing loose Customer Deposits to an
 * open order. Returns each customer's unapplied deposit balance (status 'B'
 * Customer Deposits, in cents) and their count of open sales orders — so the
 * importer can assign the balance to a customer's single open order.
 */
export async function fetchCustomerDepositInfo(
  entityIds: string[],
  config: NetsuiteConfig | null = netsuiteConfig()
): Promise<{ balanceCentsByEntity: Map<string, number>; openOrderCountByEntity: Map<string, number> }> {
  const balanceCentsByEntity = new Map<string, number>();
  const openOrderCountByEntity = new Map<string, number>();
  const ids = [...new Set(entityIds.filter((s) => /^\d+$/.test(s)))];
  if (ids.length === 0 || !config) return { balanceCentsByEntity, openOrderCountByEntity };

  const CH = 400;
  for (let i = 0; i < ids.length; i += CH) {
    const chunk = ids.slice(i, i + CH).join(",");
    const [deps, ords] = await Promise.all([
      runSuiteQL(
        `SELECT entity, SUM(foreigntotal) AS bal FROM transaction WHERE type = 'CustDep' AND status = 'B' AND entity IN (${chunk}) GROUP BY entity`,
        config,
        "deposit balances"
      ),
      runSuiteQL(
        `SELECT entity, COUNT(*) AS c FROM transaction WHERE type = 'SalesOrd' AND intercompany = 'F' AND status IN ('A','B','D','E','F') AND entity IN (${chunk}) GROUP BY entity`,
        config,
        "open order counts"
      ),
    ]);
    for (const r of deps) {
      const e = String(r.entity ?? "");
      const bal = centsFromCost(r.bal);
      if (e && bal != null) balanceCentsByEntity.set(e, bal);
    }
    for (const r of ords) {
      const e = String(r.entity ?? "");
      if (e) openOrderCountByEntity.set(e, Number(r.c ?? 0));
    }
  }
  return { balanceCentsByEntity, openOrderCountByEntity };
}
