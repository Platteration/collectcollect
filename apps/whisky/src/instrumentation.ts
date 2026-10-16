export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { engine } = await import("./lib/engine");
    engine.scheduler.start();
  }
}
