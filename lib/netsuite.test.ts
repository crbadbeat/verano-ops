import { describe, it, expect, vi, afterEach } from "vitest";
import {
  percentEncode,
  netsuiteHost,
  oauthBaseString,
  authorizationHeader,
  centsFromCost,
  mapItemRow,
  isCreatableItemType,
  runSuiteQL,
  type NetsuiteConfig,
} from "./netsuite";

describe("percentEncode (RFC 3986)", () => {
  it("encodes reserved chars and leaves unreserved ones", () => {
    expect(percentEncode("a b")).toBe("a%20b");
    expect(percentEncode("A-Z_a.z~9")).toBe("A-Z_a.z~9");
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
    expect(percentEncode("q=1&r=2")).toBe("q%3D1%26r%3D2");
  });
});

describe("netsuiteHost", () => {
  it("builds the production host", () => {
    expect(netsuiteHost("1234567")).toBe(
      "https://1234567.suitetalk.api.netsuite.com"
    );
  });
  it("slugifies a sandbox account id", () => {
    expect(netsuiteHost("1234567_SB1")).toBe(
      "https://1234567-sb1.suitetalk.api.netsuite.com"
    );
    expect(netsuiteHost("TSTDRV99")).toBe(
      "https://tstdrv99.suitetalk.api.netsuite.com"
    );
  });
});

describe("oauthBaseString", () => {
  it("sorts params and percent-encodes the whole thing", () => {
    const base = oauthBaseString("post", "https://x.test/q", { b: "2", a: "1" });
    expect(base).toBe("POST&https%3A%2F%2Fx.test%2Fq&a%3D1%26b%3D2");
  });
});

describe("authorizationHeader", () => {
  const config: NetsuiteConfig = {
    accountId: "1234567_SB1",
    consumerKey: "ck",
    consumerSecret: "cs",
    tokenId: "tk",
    tokenSecret: "ts",
  };

  it("is deterministic for fixed nonce + timestamp and carries the realm", () => {
    const a = authorizationHeader("POST", "https://x.test/q", { limit: "1000" }, config, "nonce1", "1700000000");
    const b = authorizationHeader("POST", "https://x.test/q", { limit: "1000" }, config, "nonce1", "1700000000");
    expect(a).toBe(b);
    expect(a).toContain('realm="1234567_SB1"');
    expect(a).toContain('oauth_signature_method="HMAC-SHA256"');
    expect(a).toContain('oauth_consumer_key="ck"');
    expect(a).toMatch(/oauth_signature="[^"]+"/);
  });

  it("changes the signature when a secret changes", () => {
    const a = authorizationHeader("POST", "https://x.test/q", {}, config, "n", "1700000000");
    const b = authorizationHeader(
      "POST",
      "https://x.test/q",
      {},
      { ...config, tokenSecret: "different" },
      "n",
      "1700000000"
    );
    const sigA = a.match(/oauth_signature="([^"]+)"/)?.[1];
    const sigB = b.match(/oauth_signature="([^"]+)"/)?.[1];
    expect(sigA).toBeTruthy();
    expect(sigA).not.toBe(sigB);
  });
});

describe("runSuiteQL", () => {
  const cfg: NetsuiteConfig = {
    accountId: "1234567",
    consumerKey: "ck",
    consumerSecret: "cs",
    tokenId: "tk",
    tokenSecret: "ts",
  };

  afterEach(() => vi.unstubAllGlobals());

  it("paginates until hasMore is false and concatenates the rows", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: "1" }], hasMore: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: "2" }], hasMore: false }) });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await runSuiteQL("SELECT id FROM item", cfg);

    expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second page advances the offset in the (signed) query string.
    expect(String(fetchMock.mock.calls[0][0])).toContain("offset=0");
    expect(String(fetchMock.mock.calls[1][0])).toContain("offset=1000");
    // It POSTs the statement as { q } with the transient header.
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ q: "SELECT id FROM item" });
    expect(init.headers.Prefer).toBe("transient");
  });

  it("throws a labelled error carrying the status and body on a non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "no permission" })
    );
    await expect(runSuiteQL("SELECT 1", cfg, "orders")).rejects.toThrow(
      "NetSuite orders 400: no permission"
    );
  });

  it("throws NetsuiteNotConfiguredError when no credentials are given", async () => {
    await expect(runSuiteQL("SELECT 1", null)).rejects.toThrow(/not configured/i);
  });
});

describe("centsFromCost", () => {
  it("parses dollars into integer cents", () => {
    expect(centsFromCost("12.34")).toBe(1234);
    expect(centsFromCost(12.5)).toBe(1250);
    expect(centsFromCost("$1,234.50")).toBe(123450);
    expect(centsFromCost(0)).toBe(0);
  });
  it("rejects blanks, negatives and non-numbers", () => {
    expect(centsFromCost("")).toBeNull();
    expect(centsFromCost(null)).toBeNull();
    expect(centsFromCost(undefined)).toBeNull();
    expect(centsFromCost("-5")).toBeNull();
    expect(centsFromCost("abc")).toBeNull();
  });
});

describe("mapItemRow", () => {
  it("maps a SuiteQL item row onto the normalized shape (average cost wins)", () => {
    expect(
      mapItemRow({
        id: "4821",
        itemid: "GSL-32-PRO",
        displayname: "Grill 32 Pro",
        description: "32 inch pro grill",
        upccode: "0123456789012",
        averagecost: "402.50",
        cost: "419.99", // purchase price — ignored when average cost is present
        itemtype: "InvtPart",
      })
    ).toEqual({
      netsuiteNumber: "4821",
      name: "Grill 32 Pro",
      description: "32 inch pro grill",
      barcode: "0123456789012",
      standardCostCents: 40250,
      itemType: "InvtPart",
    });
  });

  it("falls back to purchase price when there is no average cost", () => {
    expect(mapItemRow({ id: "99", itemid: "NO-AVG", cost: "12.34" })!.standardCostCents).toBe(1234);
  });

  it("falls back to itemid for the name and tolerates missing fields", () => {
    expect(mapItemRow({ id: "7", itemid: "RAW-STEEL" })).toEqual({
      netsuiteNumber: "7",
      name: "RAW-STEEL",
      description: null,
      barcode: null,
      standardCostCents: null,
      itemType: "",
    });
  });

  it("returns null for a row without an id", () => {
    expect(mapItemRow({ itemid: "NO-ID" })).toBeNull();
  });
});

describe("isCreatableItemType", () => {
  it("lets the sync create purchased/stocked types", () => {
    expect(isCreatableItemType("InvtPart")).toBe(true);
    expect(isCreatableItemType("NonInvtPart")).toBe(true);
    expect(isCreatableItemType("invtpart")).toBe(true); // case-insensitive
    expect(isCreatableItemType("  NonInvtPart  ")).toBe(true);
  });

  it("never auto-creates configured Base/Top types (Assembly/Kit) or junk", () => {
    // Assembly/Kit are configured Bases/Tops — born at order intake on a smart-SKU,
    // linked later by number; the sync updates but never creates them.
    expect(isCreatableItemType("Assembly")).toBe(false);
    expect(isCreatableItemType("Kit")).toBe(false);
    expect(isCreatableItemType("Service")).toBe(false);
    expect(isCreatableItemType("")).toBe(false);
  });
});
