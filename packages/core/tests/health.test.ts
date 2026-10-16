import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthRoute } from "../src/domain/health";
import { widgetEngine } from "./widgets";

const ask = async (route: ReturnType<typeof createHealthRoute>) => {
  const res = await route.GET();
  return { res, body: (await res.json()) as Record<string, unknown> };
};

describe("the health route", () => {
  let engine: ReturnType<typeof widgetEngine>;
  let route: ReturnType<typeof createHealthRoute>;
  beforeEach(() => {
    engine = widgetEngine();
    // The connection is shared by everything in this process, and an earlier test may have left one; a fresh install has none.
    engine.db.setDb(undefined);
    route = createHealthRoute(engine);
  });

  it("says the server is up and the collection does not exist yet, without creating one", async () => {
    const { res, body } = await ask(route);
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, app: `collectcollect-${engine.spec.id}`, database: false });
    expect(engine.db.databaseExists()).toBe(false);
  });

  it("says the collection answers once it exists", async () => {
    engine.repo.createItem({ name: "Gizmo" });
    const { body } = await ask(route);
    expect(body).toMatchObject({ ok: true, database: true });
  });

  it("says the collection does not answer when it cannot be read, and keeps the reason in the log", async () => {
    engine.repo.createItem({ name: "Gizmo" });
    engine.db.lockDatabase("A restore is in progress, so the collection is not readable.");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { res, body } = await ask(route);
      // Still a working server, and still nothing about why on the wire.
      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, app: `collectcollect-${engine.spec.id}`, database: false });
      expect(JSON.stringify(body)).not.toContain("restore");
      expect(logged).toHaveBeenCalledWith("[health]", expect.stringContaining("A restore is in progress"));
    } finally {
      engine.db.unlockDatabase();
      logged.mockRestore();
    }
  });

  it("is never kept by a cache, and gives nothing away", async () => {
    engine.repo.createItem({ name: "Gizmo" });
    const { res, body } = await ask(route);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["app", "database", "ok"]);
  });
});
