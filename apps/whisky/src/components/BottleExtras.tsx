import type { SimpleExtras } from "@collectcollect/core/domain/pricing/index";
import type { ItemPageContext, ItemPageExtras } from "@collectcollect/core/pages/ItemPage";
import { money } from "@collectcollect/core/format";
import type { Bottle, BottleSettings } from "@/lib/types";
import { OpenBottle } from "./OpenBottle";

/** What only this domain adds to a bottle's page: the open-a-bottle action, and what opening did to its value. */
export function bottleExtras(ctx: ItemPageContext<Bottle, BottleSettings, SimpleExtras>): ItemPageExtras {
  const { item } = ctx;
  if (item.sealed) {
    return {
      afterPrice: item.quantity > 0 ? <OpenBottle itemId={item.id} quantity={item.quantity} /> : null,
      // The badge above already reads "Sealed · Box", so neither belongs in the facts as well.
      handled: ["openedAt", "frozenValue", "fillLevel", "sealed", "packaging"],
    };
  }
  return {
    header: (
      <p className="mt-2 text-sm">
        <span className="badge border" style={{ borderColor: "var(--line-strong)" }}>
          Open{item.openedAt ? ` since ${item.openedAt}` : ""} · {item.fillLevel ?? "?"}% left
        </span>
      </p>
    ),
    afterPrice: (
      <p className="card-surface p-4 text-sm" style={{ color: "var(--muted)" }}>
        {item.frozenValue !== null
          ? `Frozen at ${money(item.frozenValue)} when it was opened. Prices entered from now on are kept as history but the bottle is valued at that figure and left out of the portfolio total.`
          : "Opened before it was ever valued, so it carries no value. Enter what it was worth on the day it was opened if you want it on the report."}
      </p>
    ),
    // The badge reads "Open since … · 60% left"; the packaging is still worth a line.
    handled: ["openedAt", "frozenValue", "sealed"],
  };
}
