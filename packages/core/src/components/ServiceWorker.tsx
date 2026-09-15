"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the app installable and lets the
 * shell open without a network. Registration is deliberately quiet: a browser
 * without support, or a page served over plain HTTP, simply carries on.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
