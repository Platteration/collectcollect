import Link from "next/link";

/** Rendered inside the layout, so the header and the tab bar are still there to leave by. */
export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Not here</h1>
      <p className="mt-2 text-sm text-neutral-500">
        There is no page at this address. A card that was deleted takes its page with it.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/collection" className="btn-primary">
          Open the collection
        </Link>
        <Link href="/" className="btn-secondary">
          Portfolio
        </Link>
      </div>
    </div>
  );
}
