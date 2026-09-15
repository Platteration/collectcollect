import Link from "next/link";

/**
 * The page for an address that has nothing at it. Rendered inside the app's
 * layout, so the header and the tab bar are still there to leave by; the
 * words name what the app keeps, since a deleted card and a removed item both
 * take their page with them.
 */
export function NotFound({ thing, homeHref, homeLabel }: { thing: string; homeHref: string; homeLabel: string }) {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Not here</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        There is no page at this address. {thing === "collection" ? "A card that was deleted" : "An item that was removed"} takes its
        page with it.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href={homeHref} className="btn-primary">
          {homeLabel}
        </Link>
        <Link href="/" className="btn-secondary">
          Portfolio
        </Link>
      </div>
    </div>
  );
}
