export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPriceScheduler } = await import("./lib/scheduler");
    startPriceScheduler();
  }
}
