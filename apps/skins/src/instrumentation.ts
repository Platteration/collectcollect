export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Said once at boot, because "which folder is this server reading?" is the
    // first question when an inventory looks empty.
    const { dataDir } = await import("./lib/db");
    console.log(`[collectcollect-skins] Data directory: ${dataDir()}`);
    // The one invariant everything about money rests on: every copy belongs to
    // a lot. Checked at boot rather than on a request, and only when there is a
    // database to check, so an empty data directory is not created just to look.
    const { databaseExists } = await import("./lib/db");
    if (databaseExists()) {
      const { verifyLotInvariant } = await import("./lib/acquisitions");
      const broken = verifyLotInvariant();
      if (broken.length > 0) {
        console.warn(
          `[collectcollect-skins] ${broken.length} item(s) whose quantity and purchase lots disagree: ${broken.slice(0, 20).join(", ")}${broken.length > 20 ? "…" : ""}. Editing the count on each puts them right.`,
        );
      }
    }
    const { startPriceScheduler } = await import("./lib/scheduler");
    startPriceScheduler();
  }
}
