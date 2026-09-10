import type { SimpleExtras } from "@collectcollect/core/domain/pricing/index";
import type { ItemPageContext, ItemPageExtras } from "@collectcollect/core/pages/ItemPage";
import type { Watch, WatchSettings } from "@/lib/types";
import { ServiceHistory } from "./ServiceHistory";

/** What only this domain adds to a watch's page: the reference and serial under the title, and the service log at the end. */
export function watchExtras(ctx: ItemPageContext<Watch, WatchSettings, SimpleExtras>): ItemPageExtras {
  const { item } = ctx;
  return {
    header: (
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {item.referenceNumber && (
          <span>
            Ref. <span className="font-medium">{item.referenceNumber}</span>
          </span>
        )}
        {item.serialNumber && (
          <span>
            Serial <span className="font-medium">{item.serialNumber}</span>{" "}
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              (private)
            </span>
          </span>
        )}
      </p>
    ),
    end: <ServiceHistory itemId={item.id} entries={item.serviceHistory ?? []} />,
    handled: ["serviceHistory", "referenceNumber", "serialNumber"],
    valueNote: item.manualValue === null ? "enter a value, or past values with dates, to draw the chart" : undefined,
  };
}
