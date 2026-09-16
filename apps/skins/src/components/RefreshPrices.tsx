"use client";
import { PriceRefresh } from "@collectcollect/core/components/PriceRefresh";
export function RefreshPrices({ items }: { items: number }) {
  return <PriceRefresh count={items} detailPath="/items" label="Refresh every price" />;
}
