import "server-only";
import { prisma } from "@/lib/db";
import { matchKey } from "@/lib/alias";
import { decodeSku } from "@/lib/sku";
import { getGrammar } from "@/lib/sku-grammar";
import { deriveOrder, type DerivedOrder, type ParsedOrder } from "@/lib/order-derive";
import {
  CONFIGURATOR_CATALOGUE,
  type CatalogueLine,
  type CatalogueOption,
} from "@/lib/configurator-catalogue";
import { billingDiffersFromDelivery } from "@/lib/order-payments";
import type { Prisma } from "@prisma/client";

// Persisting a decoded order. Everything derived is written down — the island's
// configuration, the composed SKUs, every line and where it came from — so the
// order explains itself later without being re-decoded.

/**
 * Order numbers are prefixed by source. "P14454" is POS order 14454; a legacy
 * backfill row keeps its own prefix. The bare number is kept alongside so the
 * importer can spot an order the POS already sent instead of duplicating it.
 */
export function posOrderNo(bare: string): string {
  const clean = bare.trim().replace(/^P/i, "");
  return `P${clean}`;
}

// ---- the decode catalogue ---------------------------------------------------

/**
 * The catalogue used to decode an order.
 *
 * THE BUILT-IN TABLES WIN. A stored row can do exactly two things: switch a
 * built-in option OFF, or add an option that does not exist in code yet (the
 * configurator gains a model, and orders decode before the next deploy).
 *
 * It used to be the other way round — stored rows overrode built-in ones — and
 * that quietly broke a change three separate times: editing an option in code
 * did nothing until someone remembered to refresh the database copy. Nothing was
 * lost by inverting it, because fixing how an item maps to a product is already
 * handled better elsewhere: mapping an unmatched line on an order writes a
 * PickAlias, which is remembered for every order after it.
 */
export async function loadCatalogue(): Promise<CatalogueOption[]> {
  const rows = await prisma.configOption.findMany();
  if (rows.length === 0) return CONFIGURATOR_CATALOGUE;

  const stored = new Map(rows.map((r) => [`${r.param}|${r.code}`, r]));
  const builtInKeys = new Set(
    CONFIGURATOR_CATALOGUE.map((o) => `${o.param}|${o.code}`)
  );

  const out = CONFIGURATOR_CATALOGUE.filter(
    (o) => stored.get(`${o.param}|${o.code}`)?.active !== false
  );

  for (const row of rows) {
    if (builtInKeys.has(`${row.param}|${row.code}`) || !row.active) continue;
    out.push({
      param: row.param as CatalogueOption["param"],
      code: row.code,
      label: row.label,
      aliases: row.aliases,
      attrKey: row.attrKey ?? undefined,
      attrValue: row.attrValue ?? undefined,
      attrDelta: row.attrDelta ?? undefined,
      lines: Array.isArray(row.lines)
        ? (row.lines as unknown as CatalogueLine[])
        : undefined,
    });
  }
  return out;
}

// ---- resolving a line label to a product ------------------------------------

export interface LineResolver {
  resolve(label: string, sku: string | null): string | null;
}

/**
 * Build a resolver over the whole product master plus the alias map. Lines carry
 * labels, not ids: a SKU we composed matches a product outright, and everything
 * else is a human-readable name that resolves through PickAlias — the hub-native
 * scan-alias table (and the same learning loop) every free-text line already uses.
 */
export async function buildLineResolver(): Promise<LineResolver> {
  const [products, aliases] = await Promise.all([
    prisma.product.findMany({ select: { id: true, sku: true, name: true } }),
    prisma.pickAlias.findMany({ select: { matchKey: true, productId: true } }),
  ]);

  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p.id]));
  const byName = new Map(products.map((p) => [matchKey(p.name), p.id]));
  const byAlias = new Map(aliases.map((a) => [a.matchKey, a.productId]));

  return {
    resolve(label, sku) {
      if (sku) {
        const bySkuHit = bySku.get(sku.toLowerCase());
        if (bySkuHit) return bySkuHit;
      }
      const key = matchKey(label);
      return bySku.get(label.trim().toLowerCase()) ?? byName.get(key) ?? byAlias.get(key) ?? null;
    },
  };
}

// ---- auto-creating a configured product -------------------------------------

/**
 * A decoded configuration that has no product yet. The product owner's ruling:
 * create it — an order is a committed unit, not a catalogue possibility — but
 * leave it unlinked so it surfaces in the NetSuite match queue.
 *
 * Note this is deliberately narrower than the "never invent products" rule that
 * governs the lookup-sheet import: that import sees 1,739 hypothetical builds,
 * this sees one thing a customer actually bought.
 */
async function ensureConfiguredProduct(
  tx: Prisma.TransactionClient,
  sku: string,
  category: "Base" | "Glass",
  parentSku: string | null,
  known: Map<string, string>
): Promise<{ id: string; created: boolean }> {
  const alreadyKnown = known.get(sku);
  if (alreadyKnown) return { id: alreadyKnown, created: false };

  const decoded = decodeSku(sku, getGrammar(category));
  const created = await tx.product.create({
    data: {
      sku,
      name: sku,
      category,
      attributes: decoded.attributes.length
        ? (decoded.attributes as unknown as Prisma.InputJsonValue)
        : undefined,
      parentSku: parentSku ?? undefined,
      // Left unlinked on purpose: this is what the NetSuite match queue is for.
      netsuiteLinkedAt: null,
    },
    select: { id: true },
  });
  known.set(sku, created.id);
  return { id: created.id, created: true };
}

// ---- creating an order ------------------------------------------------------

export interface CreateOrderInput {
  parsed: ParsedOrder;
  orderNo: string;
  userId: string | null;
  document?: {
    filename: string;
    sha256: string;
    extractedText: string;
  };
}

export interface CreateOrderResult {
  orderId: string;
  orderNo: string;
  derived: DerivedOrder;
  createdProducts: string[];
  unmatched: number;
}

/**
 * Write a derived configuration into an order: its islands, the products those
 * islands need, and every pickable line. Shared by first entry and by applying
 * an addendum, so an addendum can never produce something a new order could not.
 */
async function writeConfiguration(
  tx: Prisma.TransactionClient,
  orderId: string,
  derived: DerivedOrder,
  resolver: LineResolver,
  blankExists: Set<string>,
  /** Island SKUs already in the product master, looked up in one query. */
  knownIslandProducts: Map<string, string>
): Promise<{ createdProducts: string[]; unmatched: number }> {
  const createdProducts: string[] = [];
  const islandIds: string[] = [];

  for (const island of derived.islands) {
    const blank = island.topBlankCandidates.find((c) => blankExists.has(c)) ?? null;

    let baseProductId: string | null = null;
    if (island.baseSku) {
      const p = await ensureConfiguredProduct(
        tx,
        island.baseSku,
        "Base",
        null,
        knownIslandProducts
      );
      baseProductId = p.id;
      if (p.created) createdProducts.push(island.baseSku);
    }
    let topProductId: string | null = null;
    if (island.topSku) {
      const p = await ensureConfiguredProduct(
        tx,
        island.topSku,
        "Glass",
        blank,
        knownIslandProducts
      );
      topProductId = p.id;
      if (p.created) createdProducts.push(island.topSku);
    }

    const row = await tx.orderIsland.create({
      data: {
        orderId,
        position: island.position,
        role: island.role,
        styleCode: island.styleCode,
        grillPosition: island.grillPosition,
        attributes: island.attributes as unknown as Prisma.InputJsonValue,
        baseSku: island.baseSku,
        baseProductId,
        topSku: island.topSku,
        topProductId,
        topBlankSku: blank,
      },
      select: { id: true },
    });
    islandIds.push(row.id);
  }

  // Resolve every line IN MEMORY, then insert them in one statement.
  //
  // This used to be a round trip per line, and a round trip again for any line
  // the resolver missed. A 97-line order took 16s that way — past what a
  // serverless request gets, so a big order simply failed. The base and top
  // products were just created above, so their ids are already to hand.
  let unmatched = 0;
  const rows: Prisma.OrderLineCreateManyInput[] = derived.lines.map((line) => {
    const productId =
      (line.sku ? knownIslandProducts.get(line.sku) ?? null : null) ??
      resolver.resolve(line.label, line.sku);
    if (!productId) unmatched++;
    return {
      orderId,
      islandId: line.islandIndex != null ? islandIds[line.islandIndex] ?? null : null,
      origin: line.origin,
      productId,
      sku: line.sku,
      rawLabel: line.label,
      qty: line.qty,
    };
  });
  if (rows.length) await tx.orderLine.createMany({ data: rows });

  return { createdProducts, unmatched };
}

/**
 * Look up every product an order's islands need, in one query. Anything missing
 * is created inside the transaction; this just avoids a lookup per island.
 */
async function findIslandProducts(derived: DerivedOrder): Promise<Map<string, string>> {
  const skus = derived.islands
    .flatMap((i) => [i.baseSku, i.topSku])
    .filter((s): s is string => !!s);
  if (skus.length === 0) return new Map();
  const found = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true },
  });
  return new Map(found.map((p) => [p.sku, p.id]));
}

/**
 * Which uncut top each configured top could be cut from. Looked up for
 * VISIBILITY only — no GlassMod is raised. A blank is fungible and a customer
 * may not take delivery for months, so glass is not cut until they are
 * scheduled; cutting early would spend a blank the next sale needs.
 */
async function findExistingBlanks(derived: DerivedOrder): Promise<Set<string>> {
  const candidates = [...new Set(derived.islands.flatMap((i) => i.topBlankCandidates))];
  if (candidates.length === 0) return new Set();
  const found = await prisma.product.findMany({
    where: { sku: { in: candidates } },
    select: { sku: true },
  });
  return new Set(found.map((b) => b.sku));
}

export async function createOrderFromParsed(
  input: CreateOrderInput
): Promise<CreateOrderResult> {
  const derived = deriveOrder(input.parsed, await loadCatalogue());
  // Everything the write needs, gathered before the transaction opens so it does
  // as little as possible while holding one.
  const [resolver, blankExists, knownIslandProducts] = await Promise.all([
    buildLineResolver(),
    findExistingBlanks(derived),
    findIslandProducts(derived),
  ]);
  const header = input.parsed.header;
  let createdProducts: string[] = [];

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNo: input.orderNo,
        posOrderNo: header.posOrderNo ?? null,
        source: input.parsed.source,
        customerFirst: header.customerFirst ?? null,
        customerLast: header.customerLast ?? null,
        email: header.email ?? null,
        phone: header.phone ?? null,
        cell: header.cell ?? null,
        billingAddress: header.billing?.address ?? null,
        billingCity: header.billing?.city ?? null,
        billingState: header.billing?.state ?? null,
        billingZip: header.billing?.zip ?? null,
        deliveryAddress: header.delivery?.address ?? null,
        deliveryCity: header.delivery?.city ?? null,
        deliveryState: header.delivery?.state ?? null,
        deliveryZip: header.delivery?.zip ?? null,
        gallery: header.gallery ?? null,
        gtlId: header.gtlId ?? null,
        repId: header.repId ?? null,
        salesRepName: header.salesRepName ?? null,
        purchasedAt: header.purchasedAt ? new Date(`${header.purchasedAt}T00:00:00Z`) : null,
        requestedTimeframe: header.requestedTimeframe ?? null,
        gasType: header.gasType ?? null,
        veranoForLife: header.veranoForLife ?? false,
        veranoForLifeTier: header.veranoForLifeTier ?? null,
        // A delivery address that is not the billing address gets a manual
        // fraud check before the order is worked.
        fraudCheckStatus: billingDiffersFromDelivery(
          {
            address: header.billing?.address,
            city: header.billing?.city,
            state: header.billing?.state,
            zip: header.billing?.zip,
          },
          {
            address: header.delivery?.address,
            city: header.delivery?.city,
            state: header.delivery?.state,
            zip: header.delivery?.zip,
          }
        )
          ? "REQUIRED"
          : "NOT_REQUIRED",
        ...(header.totals ?? {}),
        createdById: input.userId,
      },
      select: { id: true },
    });

    const written = await writeConfiguration(
      tx,
      order.id,
      derived,
      resolver,
      blankExists,
      knownIslandProducts
    );
    createdProducts = written.createdProducts;
    const unmatched = written.unmatched;

    if (input.document) {
      await tx.orderDocument.create({
        data: {
          orderId: order.id,
          kind: "ORIGINAL",
          filename: input.document.filename,
          sha256: input.document.sha256,
          extractedText: input.document.extractedText,
          parsedJson: input.parsed as unknown as Prisma.InputJsonValue,
          uploadedById: input.userId,
        },
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "CREATED",
        summary: `Order created from ${sourceLabel(input.parsed.source)}`,
        detail: {
          islands: derived.islands.length,
          lines: derived.lines.length,
          unmatched,
          createdProducts,
          warnings: derived.warnings,
        },
        userId: input.userId,
      },
    });

    return { orderId: order.id, unmatched };
  }, TX_OPTIONS);

  return {
    orderId: result.orderId,
    orderNo: input.orderNo,
    derived,
    createdProducts,
    unmatched: result.unmatched,
  };
}

// A configured order writes an island, two products and thirty-odd lines one row
// at a time over the Supabase pooler, which outruns Prisma's 5s default.
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export interface ReplaceConfigurationResult {
  derived: DerivedOrder;
  createdProducts: string[];
  unmatched: number;
  added: string[];
  removed: string[];
}

/**
 * Re-issue an order's configuration from a newer document (an addendum).
 * Lines someone added by hand are kept: an addendum re-states what was sold, not
 * the warehouse's own notes. One transaction, so the order is never half-applied.
 */
export async function replaceConfiguration(
  orderId: string,
  parsed: ParsedOrder,
  userId: string | null,
  document: { filename: string; sha256: string; extractedText: string }
): Promise<ReplaceConfigurationResult> {
  const derived = deriveOrder(parsed, await loadCatalogue());
  const [resolver, blankExists, knownIslandProducts] = await Promise.all([
    buildLineResolver(),
    findExistingBlanks(derived),
    findIslandProducts(derived),
  ]);

  const previous = await prisma.orderLine.findMany({
    where: { orderId, origin: { not: "MANUAL" } },
    select: { qty: true, sku: true, rawLabel: true },
  });
  const before = previous.map((l) => `${l.qty} × ${l.sku ?? l.rawLabel}`).sort();
  const after = derived.lines.map((l) => `${l.qty} × ${l.sku ?? l.label}`).sort();
  const added = after.filter((a) => !before.includes(a));
  const removed = before.filter((b) => !after.includes(b));

  const written = await prisma.$transaction(async (tx) => {
    await tx.orderLine.deleteMany({ where: { orderId, origin: { not: "MANUAL" } } });
    // Lines keep a nullable islandId with onDelete: SetNull, so a surviving
    // manual line simply loses its island reference rather than blocking this.
    await tx.orderIsland.deleteMany({ where: { orderId } });

    const result = await writeConfiguration(
      tx,
      orderId,
      derived,
      resolver,
      blankExists,
      knownIslandProducts
    );

    await tx.orderDocument.create({
      data: {
        orderId,
        kind: "ADDENDUM",
        filename: document.filename,
        sha256: document.sha256,
        extractedText: document.extractedText,
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        uploadedById: userId,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        type: "ADDENDUM_APPLIED",
        summary: `Addendum applied — ${added.length} line(s) added, ${removed.length} removed`,
        detail: {
          added,
          removed,
          createdProducts: result.createdProducts,
          warnings: derived.warnings,
        },
        userId,
      },
    });

    return result;
  }, TX_OPTIONS);

  return { derived, ...written, added, removed };
}

export function sourceLabel(source: ParsedOrder["source"]): string {
  switch (source) {
    case "POS_PDF":
      return "a Final Sales Agreement";
    case "CONFIGURATOR_URL":
      return "a configurator link";
    case "LEGACY_IMPORT":
      return "the legacy order file";
    default:
      return "manual entry";
  }
}

// ---- reading ----------------------------------------------------------------

export async function getOrderDetail(orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    include: {
      islands: {
        orderBy: { position: "asc" },
        include: {
          baseProduct: { select: { id: true, sku: true, netsuiteLinkedAt: true } },
          topProduct: { select: { id: true, sku: true, netsuiteLinkedAt: true } },
        },
      },
      lines: {
        orderBy: [{ origin: "asc" }, { rawLabel: "asc" }],
        include: {
          product: {
            select: { id: true, sku: true, displayName: true, name: true, pickable: true },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "asc" },
        include: { createdBy: { select: { email: true } } },
      },
      documents: { orderBy: { uploadedAt: "desc" } },
      events: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { email: true } } },
      },
      createdBy: { select: { email: true } },
    },
  });
}

/** Record an activity-log entry. Every mutation of an order goes through here. */
export async function logOrderEvent(
  orderId: string,
  type: string,
  summary: string,
  userId: string | null,
  detail?: Prisma.InputJsonValue
): Promise<void> {
  await prisma.orderEvent.create({
    data: { orderId, type, summary, detail, userId },
  });
}
