import { beforeEach, describe, expect, it } from "vitest";
import { createRoutes } from "../src/domain/routes";
import { widgetEngine } from "./widgets";

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const json = (url: string, method: string, body: unknown) =>
  new Request(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const read = async <T,>(res: Response) => (await res.json()) as T;

describe("the generic routes", () => {
  let engine: ReturnType<typeof widgetEngine>;
  let routes: ReturnType<typeof createRoutes>;
  beforeEach(() => {
    engine = widgetEngine();
    routes = createRoutes(engine);
  });

  it("creates, reads, patches and deletes an item", async () => {
    const created = await routes.items.POST(json("http://x/api/items", "POST", { name: "Gizmo", kind: "gizmo" }));
    expect(created.status).toBe(201);
    const { item } = await read<{ item: { id: number } }>(created);
    const got = await routes.item.GET(new Request("http://x"), ctx({ id: String(item.id) }));
    expect((await read<{ item: { name: string } }>(got)).item.name).toBe("Gizmo");
    const patched = await routes.item.PATCH(json("http://x", "PATCH", { location: "Shelf" }), ctx({ id: String(item.id) }));
    expect((await read<{ item: { location: string } }>(patched)).item.location).toBe("Shelf");
    for (const id of ["abc", "0", "-1", "999"]) expect((await routes.item.GET(new Request("http://x"), ctx({ id }))).status).toBe(404);
    expect((await routes.item.DELETE(new Request("http://x"), ctx({ id: String(item.id) }))).status).toBe(200);
    expect(engine.repo.listItems()).toHaveLength(0);
  });

  it("filters the list from the query string", async () => {
    engine.repo.createItem({ name: "A", kind: "gizmo", location: "Shelf" });
    engine.repo.createItem({ name: "B", kind: "gadget" });
    const res = await routes.items.GET(new Request("http://x/api/items?f_kind=gizmo"));
    expect((await read<{ items: Array<{ name: string }> }>(res)).items.map((i) => i.name)).toEqual(["A"]);
    const none = await routes.items.GET(new Request("http://x/api/items?location=none"));
    expect((await read<{ items: Array<{ name: string }> }>(none)).items.map((i) => i.name)).toEqual(["B"]);
  });

  it("refuses a manual value that is not a number and clears one that is empty", async () => {
    const w = engine.repo.createItem({ name: "Gizmo", manualValue: 5 });
    expect((await routes.itemPrice.PUT(json("http://x", "PUT", { manualValue: "abc" }), ctx({ id: String(w.id) }))).status).toBe(400);
    const cleared = await routes.itemPrice.PUT(json("http://x", "PUT", { manualValue: "" }), ctx({ id: String(w.id) }));
    expect((await read<{ item: { manualValue: null } }>(cleared)).item.manualValue).toBeNull();
    const keyed = await routes.itemPrice.PUT(json("http://x", "PUT", { manualPrices: { "PSA 10": 12 } }), ctx({ id: String(w.id) }));
    expect((await read<{ item: { manualPrices: Record<string, number> } }>(keyed)).item.manualPrices).toEqual({ "PSA 10": 12 });
  });

  it("validates settings before saving any of them", async () => {
    const bad = await routes.settings.PUT(json("http://x", "PUT", { bonus: null, ownerName: "Ada" }));
    expect(bad.status).toBe(400);
    expect(engine.settings.getSettings().ownerName).toBe("");
    const ok = await routes.settings.PUT(json("http://x", "PUT", { bonus: 9, ownerName: "Ada" }));
    expect((await read<{ settings: { bonus: number; ownerName: string } }>(ok)).settings).toMatchObject({ bonus: 9, ownerName: "Ada" });
  });

  it("only loads sample data into an empty collection", async () => {
    const seed = routes.seed(() => {
      engine.repo.createItem({ name: "Sample" });
    });
    expect((await seed.POST()).status).toBe(200);
    expect((await seed.POST()).status).toBe(409);
    expect((await routes.seed(undefined).POST()).status).toBe(404);
  });

  it("exports a spreadsheet and packages the plain-text copy", async () => {
    expect((await routes.collection.GET()).status).toBe(404);
    engine.repo.createItem({ name: "Gizmo" });
    const csv = await routes.export.GET(new Request("http://x/api/export"));
    expect(await csv.text()).toContain("Gizmo");
    const zip = await routes.collection.GET();
    expect(zip.status).toBe(200);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("serves an upload only under a name it wrote, and identifies nothing without photos", async () => {
    expect((await routes.upload.GET(new Request("http://x"), ctx({ name: "../../secrets.jpg" }))).status).toBe(404);
    expect((await routes.identify.POST(json("http://x", "POST", { uploads: [] }))).status).toBe(400);
    expect((await routes.identify.POST(json("http://x", "POST", { uploads: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg"] }))).status).toBe(404);
  });
});
