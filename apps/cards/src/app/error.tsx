"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * What a page shows when rendering it threw.
 *
 * Inside the layout, so the header still works, and with the message on the
 * page rather than in a console nobody has open: a collection app that fails
 * silently is one whose owner assumes their cards are gone.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <h1 className="font-display text-3xl font-semibold uppercase tracking-wide">Something went wrong</h1>
      <p className="mt-2 text-sm text-neutral-500">
        This page could not be drawn. Your collection is unaffected: nothing here writes to it.
      </p>
      <p className="mt-2 break-words rounded-md bg-red-50 px-3 py-2 text-left text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200" role="alert">
        {error.message || "Unknown error"}
        {error.digest && <span className="block text-xs opacity-70">ref {error.digest}</span>}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" className="btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Portfolio
        </Link>
      </div>
    </div>
  );
}
