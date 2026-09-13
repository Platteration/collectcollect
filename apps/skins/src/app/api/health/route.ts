import { NextResponse } from "next/server";
import { databaseExists } from "@/lib/db";
import { schedulerStatus } from "@/lib/scheduler";

/**
 * GET — is this server up, and what is it reading?
 *
 * Public, so a container health check or a reverse proxy can ask without a
 * session, so it says only what a health check needs: not the data directory,
 * not the last error, neither of which belongs on an unauthenticated route.
 * Nothing here opens an inventory that
 * does not exist. "ok" means the process answers, not that the inventory is
 * healthy: an install with no database yet is still a working server.
 */
export async function GET() {
  const scheduler = schedulerStatus();
  return NextResponse.json(
    {
      ok: true,
      app: "collectcollect-skins",
      database: databaseExists(),
      scheduler: { enabled: scheduler.enabled, running: scheduler.running, lastRunAt: scheduler.lastRunAt },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
