export const metadata = { title: "Offline" };

/** Shown when a page is opened with no network. */
export default function OfflinePage() {
  return (
    <div className="mx-auto mt-16 max-w-sm text-center">
      <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">No connection</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
        CollectCollect keeps your inventory on its own server, so it needs a connection to reach it. This page will
        work again as soon as you are back on the network.
      </p>
    </div>
  );
}
