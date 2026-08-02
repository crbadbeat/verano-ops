// Decode a saved Verano configurator link into a ParsedOrder.
//
// The grammar was recovered from the configurator's own URL reader and writer
// (`configurator_1/js/app.5d52d277.js`). Separators are "," inside an entry and
// ";" between entries.
//
//   ISLAND        islandId,grillPosition
//   BAR_ISLAND    barId,grillPosition,rotation
//   GRILLS        slotId,grillHeadId          <- island implied by the slot id
//   STAINLESS     slotId,optionId,isBar
//   TOP           slotId,optionId,isBar       <- burners and the sink
//   FOOTREST      slotId,optionId,isBar
//   ACCESS_DOORS  isBar,doubleDoorsOn,warmingOn   <- FLAGS, always two entries
//   COMBO SHADE STONE SIDING   a single int (-1 = none)
//   HAPPY PATIOS               a flat comma-separated id list
//   STOOLS                     quantity,happyId
//
// The ACCESS_DOORS shape is the trap: it looks like the slot/option triplets
// beside it but is nothing of the kind. Confirmed against the reader source.
//
// A link carries no customer, no order number and no money — only the
// configuration. Those come from the agreement or are typed in.

import { GRILL_SLOT_IS_BAR } from "./configurator-catalogue";
import type { ParsedIsland, ParsedOption, ParsedOrder } from "./order-derive";

function entries(value: string): string[][] {
  return value
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e !== "")
    .map((e) => e.split(",").map((p) => p.trim()));
}

function flatIds(value: string): string[] {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== "-1");
}

/** Parse a configurator URL (or a bare query string) into a ParsedOrder. */
export function parseConfiguratorUrl(input: string): ParsedOrder {
  const warnings: string[] = [];
  const raw = input.trim();
  const queryStart = raw.indexOf("?");
  const query = queryStart >= 0 ? raw.slice(queryStart + 1) : raw;
  const params = new URLSearchParams(query);

  if (!params.has("ISLAND") && !params.has("BAR_ISLAND")) {
    warnings.push(
      "This link has no ISLAND or BAR_ISLAND parameter — it does not look like a saved configuration."
    );
  }

  const islands: ParsedIsland[] = [];
  let grillIndex = -1;
  let barIndex = -1;

  const islandParam = params.get("ISLAND");
  if (islandParam) {
    const [id, position] = islandParam.split(",").map((p) => p.trim());
    if (id && id !== "-1") {
      grillIndex = islands.length;
      islands.push({
        role: "GRILL",
        styleCode: id,
        grillPosition: position || "hide",
        options: [],
      });
    }
  }

  const barParam = params.get("BAR_ISLAND");
  if (barParam) {
    const [id, position] = barParam.split(",").map((p) => p.trim());
    // The third token is the bar's rotation (left | right | parallel). It is
    // presentation only — a combo forces "parallel" — and changes no SKU.
    if (id && id !== "-1") {
      barIndex = islands.length;
      islands.push({
        role: "BAR",
        styleCode: id,
        grillPosition: position || "hide",
        options: [],
      });
    }
  }

  const islandAt = (isBar: boolean): ParsedIsland | null => {
    const idx = isBar ? barIndex : grillIndex;
    return idx >= 0 ? islands[idx] : null;
  };

  const push = (isBar: boolean, opt: ParsedOption, what: string): void => {
    const target = islandAt(isBar);
    if (!target) {
      warnings.push(
        `The link puts ${what} on the ${isBar ? "bar" : "grill"} island, but no such island is selected.`
      );
      return;
    }
    target.options.push(opt);
  };

  // Grill heads. No isBar field — the slot id says which island it is on.
  for (const [slot, headId] of entries(params.get("GRILLS") ?? "")) {
    if (!headId) continue;
    const isBar = GRILL_SLOT_IS_BAR[slot];
    if (isBar === undefined) {
      warnings.push(`Unknown grill slot "${slot}" — assumed to be on the grill island.`);
    }
    push(isBar ?? false, { param: "GRILLS", code: headId }, `grill head ${headId}`);
  }

  // Front stainless (fridges, drawers), top slots (burners/sink), foot rails.
  const triplets: [string, ParsedOption["param"]][] = [
    ["STAINLESS", "STAINLESS"],
    ["TOP", "TOP"],
    ["FOOTREST", "FOOTREST"],
  ];
  for (const [key, param] of triplets) {
    for (const [, optionId, isBarFlag] of entries(params.get(key) ?? "")) {
      if (!optionId) continue;
      push(isBarFlag === "1", { param, code: optionId }, `${key} option ${optionId}`);
    }
  }

  // Access doors: isBar, doubleDoorsOn, warmingOn. Flags, not a slot/option pair.
  for (const [isBarFlag, doubleOn, warmingOn] of entries(
    params.get("ACCESS_DOORS") ?? ""
  )) {
    const target = islandAt(isBarFlag === "1");
    if (!target) continue;
    if (doubleOn === "1") target.options.push({ param: "ACCESS_DOORS", code: "double" });
    if (warmingOn === "1") target.options.push({ param: "ACCESS_DOORS", code: "warming" });
  }

  // ---- order-level ----
  const extras: ParsedOption[] = [];

  for (const [key, param] of [
    ["COMBO", "COMBO"],
    ["SHADE", "SHADE"],
    ["STONE", "STONE"],
    ["SIDING", "SIDING"],
  ] as [string, ParsedOption["param"]][]) {
    const v = (params.get(key) ?? "").trim();
    if (v !== "" && v !== "-1") extras.push({ param, code: v });
  }

  for (const id of flatIds(params.get("HAPPY") ?? "")) {
    extras.push({ param: "HAPPY", code: id });
  }
  for (const id of flatIds(params.get("PATIOS") ?? "")) {
    extras.push({ param: "PATIOS", code: id });
  }

  const stools = (params.get("STOOLS") ?? "").trim();
  if (stools) {
    const [qty, typeId] = stools.split(",").map((p) => p.trim());
    const n = Number(qty);
    if (typeId && Number.isFinite(n) && n > 0) {
      // The second number is a Happy Hours id: it names the stool AND its
      // cushion colour, which is why there is no separate colour list.
      extras.push({ param: "STOOLS", code: typeId, qty: n });
    }
  }

  return {
    source: "CONFIGURATOR_URL",
    header: {},
    islands,
    extras,
    items: [],
    warnings,
  };
}
