"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** Set by /guard.js (packages/core/src/guard.ts), which every page loads before the app's own scripts. */
    collectcollectGuard?: { started(): void };
    /** Left for a /guard.js that arrives after the page started, so it never reports a failure that did not happen. */
    __collectcollectStarted?: boolean;
  }
}

/**
 * Tells the safety net that the app has started. An effect runs only once
 * React has taken the server-drawn page over, which is the moment its buttons
 * begin to work; before it, a script that failed to load or threw leaves a
 * page that looks ready and is not, and the guard says so.
 */
export function Started() {
  useEffect(() => {
    window.__collectcollectStarted = true;
    window.collectcollectGuard?.started();
  }, []);
  return null;
}
