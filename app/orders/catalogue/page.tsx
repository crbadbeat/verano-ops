import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { loadCatalogue } from "@/lib/orders";
import { CONFIGURATOR_CATALOGUE, type CatalogueLine } from "@/lib/configurator-catalogue";
import { setConfigOptionActive } from "../actions";

export const dynamic = "force-dynamic";

const PARAM_BLURB: Record<string, string> = {
  ISLAND: "Grill island models",
  BAR_ISLAND: "Bar island models",
  GRILLS: "Grill heads",
  STAINLESS: "Fridges and drawers in the island front",
  TOP: "Burners and the sink",
  FOOTREST: "Foot rails, one length per island",
  ACCESS_DOORS: "Doors and warming drawers",
  COMBO: "Pergolas and tiki huts, with their kits",
  SHADE: "Umbrellas",
  HAPPY: "Happy Hours extras",
  STOOLS: "Bar stools and cushions",
  STONE: "Stone colour of the glass top",
  SIDING: "Island siding",
  PATIOS: "Patio furniture",
};

export default async function CataloguePage() {
  const user = await getViewer();
  const canManage = can(user, "catalog:edit");

  const [active, stored] = await Promise.all([
    loadCatalogue(),
    prisma.configOption.findMany({
      select: { param: true, code: true, active: true },
    }),
  ]);

  const storedBy = new Map(stored.map((s) => [`${s.param}|${s.code}`, s]));
  const builtInKeys = new Set(CONFIGURATOR_CATALOGUE.map((o) => `${o.param}|${o.code}`));
  const activeKeys = new Set(active.map((o) => `${o.param}|${o.code}`));

  // Show the switched-off ones too, or there is no way to switch them back on.
  const everything = [
    ...CONFIGURATOR_CATALOGUE,
    ...active.filter((o) => !builtInKeys.has(`${o.param}|${o.code}`)),
  ];

  const byParam = new Map<string, typeof everything>();
  for (const option of everything) {
    const list = byParam.get(option.param) ?? [];
    list.push(option);
    byParam.set(option.param, list);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div>
        <Link href="/orders" className="text-sm text-muted hover:underline">
          ← Orders
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Decode catalogue</h1>
        <p className="text-muted mt-1">
          How every configurator option is read: what it changes in the island&apos;s
          SKU, and what it puts on the pick list. These tables were recovered from
          the configurator itself and ship with the app — they are always what
          decides the decode.
        </p>
        <p className="text-muted mt-2 text-sm">
          An option can be switched off here, and an option the configurator gains
          before the next deploy can be added to the database and will be picked
          up. To change how an item maps to a PRODUCT, map it on the order itself —
          that is remembered for every order afterwards.
        </p>
      </div>

      {[...byParam.entries()].map(([param, options]) => (
        <div key={param} className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
            <h2 className="font-semibold font-mono text-sm">{param}</h2>
            <span className="text-xs text-muted">{PARAM_BLURB[param]}</span>
            <span className="badge text-muted ml-auto">{options.length}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {options.map((o) => {
              const key = `${o.param}|${o.code}`;
              const isOn = activeKeys.has(key);
              const isAddition = !builtInKeys.has(key);
              const lines = [...(o.lines ?? []), ...(o.kit ?? [])] as CatalogueLine[];
              return (
                <li
                  key={key}
                  className={`px-4 py-2.5 text-sm space-y-1 ${isOn ? "" : "opacity-50"}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted w-8">{o.code}</span>
                    <span>{o.label}</span>
                    {o.attrKey && (
                      <span className="badge text-teal text-xs">
                        {o.attrKey}
                        {o.attrValue ? ` = ${o.attrValue}` : ""}
                        {o.attrDelta ? ` +${o.attrDelta}` : ""}
                      </span>
                    )}
                    {isAddition && <span className="badge text-ember text-xs">added here</span>}
                    {!isOn && <span className="badge text-danger text-xs">off</span>}
                    {canManage && (
                      <form action={setConfigOptionActive} className="ml-auto">
                        <input type="hidden" name="param" value={o.param} />
                        <input type="hidden" name="code" value={o.code} />
                        <input type="hidden" name="label" value={o.label} />
                        <input type="hidden" name="active" value={isOn ? "0" : "1"} />
                        <button className="btn btn-ghost py-0.5 px-2 text-xs" type="submit">
                          {isOn ? "Turn off" : "Turn on"}
                        </button>
                      </form>
                    )}
                  </div>
                  {lines.length > 0 && (
                    <p className="text-xs text-muted pl-10">
                      {lines.map((l) => `${l.qty} × ${l.label}`).join(" · ")}
                    </p>
                  )}
                  {o.aliases && o.aliases.length > 0 && (
                    <p className="text-xs text-muted pl-10">
                      also written: {o.aliases.join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {storedBy.size > 0 && (
        <p className="text-xs text-muted">
          {storedBy.size} option{storedBy.size === 1 ? "" : "s"} have a stored
          setting.
        </p>
      )}
    </div>
  );
}
