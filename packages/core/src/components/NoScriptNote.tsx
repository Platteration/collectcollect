/**
 * What a browser with JavaScript off is told, at the top of every page. The
 * pages are drawn on the server, so the collection still reads and its links
 * and search still work, but nothing can be added, changed or priced.
 */
export function NoScriptNote({ app }: { app: string }) {
  return (
    <noscript>
      <p className="noscript-note sticky top-0 z-50 border-b px-4 py-3 text-sm" style={{ borderColor: "var(--line-strong)", background: "var(--background)" }}>
        {app} needs JavaScript to add, change or price anything. Without it the pages still read, but their buttons do nothing.
        Turn JavaScript on for this site, then reload the page.
      </p>
    </noscript>
  );
}
