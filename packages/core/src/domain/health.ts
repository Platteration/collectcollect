import { NextResponse } from "next/server";
import { logError } from "../http";
import type { DomainDb } from "./db";

/**
 * GET /api/health — is this server up, and does its collection answer?
 *
 * What a container's health check (the image's HEALTHCHECK, Compose, a CI job)
 * and a reverse proxy ask. Each app lists the path among its proxy's public
 * ones, so it answers without a session, and so it says only what a health
 * check needs: which app, and whether the collection answered a query just
 * now. Not the data directory, not the error: neither belongs on a route
 * anyone who can reach the server can call.
 *
 * "ok" means the process answers, not that the collection is healthy: an
 * install with no database yet is still a working server, and nothing here
 * creates one. "database" means a query ran against the connection every
 * request uses, so a collection that exists but cannot be read (a restore in
 * progress, a file that will not open) says false rather than "the file is
 * there". The reason goes to the log.
 */
export function createHealthRoute(engine: { spec: { id: string }; db: Pick<DomainDb, "databaseExists" | "getDb"> }) {
  return {
    async GET() {
      let database = false;
      try {
        database = engine.db.databaseExists() && engine.db.getDb().prepare("SELECT 1 AS ok").get() !== undefined;
      } catch (e) {
        logError("health", e);
      }
      return NextResponse.json({ ok: true, app: `collectcollect-${engine.spec.id}`, database }, { headers: { "Cache-Control": "no-store" } });
    },
  };
}
