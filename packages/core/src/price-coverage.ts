/** Counts coverage across every holding; one fresh quote cannot hide stale ones. */
export function priceCoverage(records: Array<{ priced: boolean; fetchedAt?: string }>, staleHours = 24, now = Date.now()) {
  let fresh = 0, stale = 0, unpriced = 0;
  for (const record of records) {
    if (!record.priced) unpriced++;
    else if (record.fetchedAt && now - Date.parse(record.fetchedAt) < staleHours * 3600_000) fresh++;
    else stale++;
  }
  return { fresh, stale, unpriced };
}
