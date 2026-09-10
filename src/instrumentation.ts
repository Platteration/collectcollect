export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startPriceScheduler, startUploadSweeper } = await import("./lib/scheduler");
  startPriceScheduler();
  startUploadSweeper();

  const { authEnabled } = await import("./lib/auth");
  if (!authEnabled()) {
    // The README says this is a reasonable choice on a machine only you can
    // reach; it should not be a silent one, since the container publishes the
    // port on every interface.
    console.warn("[collectcollect] No APP_PASSWORD set: every route is open to anyone who can reach this port.");
  }
}
