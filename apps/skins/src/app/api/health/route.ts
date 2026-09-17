import { NextResponse } from "next/server";
import { databaseAnswers } from "@/lib/db";
import { schedulerStatus } from "@/lib/scheduler";
import { logError } from "@collectcollect/core/http";

/**
 * GET — is this server up, and what is it reading?
 *
 * Public, so a container health check or a reverse proxy can ask without a
 * session, so it says only what a health check needs: not the data directory,
 * not the last error, neither of which belongs on an unauthenticated route.
 * Nothing here opens an inventory that
 * does not exist. "ok" means the process answers, not that the inventory is
 * healthy: an install with no database yet is still a working server.
 * "database" means a query ran against it just now, through the same
 * connection every request uses — so a inventory whose restore journal
 * cannot be replayed reports false rather than "the file is there".
 */
export async function GET() {
  const scheduler = schedulerStatus();
  let database = false;
  try {
    database = databaseAnswers();
  } catch (e) {
    // Said in the log, where the reason belongs, and as "false" here.
    logError("health", e);
  }
  return NextResponse.json(
    {
      ok: true,
      app: "collectcollect-skins",
      database,
      scheduler: { enabled: scheduler.enabled, running: scheduler.running, lastRunAt: scheduler.lastRunAt },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
