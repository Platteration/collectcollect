export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Said once at boot, because "which folder is this server reading?" is the
    // first question when a collection looks empty.
    const { dataDir } = await import("./lib/db");
    console.log(`[collectcollect] Data directory: ${dataDir()}`);
    const { startPriceScheduler } = await import("./lib/scheduler");
    startPriceScheduler();
  }
}
