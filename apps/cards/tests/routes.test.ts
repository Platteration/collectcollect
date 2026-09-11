import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { createAlert } from "@/lib/alerts";
import { recordSale } from "@/lib/sales";

/** Routes take their path parameters as a promise. */
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

const json = (url: string, method: string, body: unknown) =>
  new Request(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

const notJson = (url: string, method: string) =>
  new Request(url, { method, body: "{not json", headers: { "Content-Type": "application/json" } });

async function read<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("ids that do not name a card", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("are all answered 404, whatever shape they are", async () => {
    const { GET, PATCH, DELETE } = await import("@/app/api/cards/[id]/route");
    for (const id of ["abc", "0", "-1", "1.5", "", "999", "1e3", " 1"]) {
      const res = await GET(new Request("http://localhost/api/cards/x"), ctx({ id }) as never);
      expect(res.status, `GET ${JSON.stringify(id)}`).toBe(404);
    }
    expect((await PATCH(json("http://localhost/api/cards/x", "PATCH", { name: "X" }), ctx({ id: "abc" }) as never)).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/cards/x", { method: "DELETE" }), ctx({ id: "abc" }) as never)).status).toBe(404);
  });

  it("reach the card when they do name one", async () => {
    const card = createCard({ game: "pokemon", name: "Snorlax" });
    const { GET, PATCH } = await import("@/app/api/cards/[id]/route");
    const res = await GET(new Request("http://localhost/api/cards/1"), ctx({ id: String(card.id) }) as never);
    expect(res.status).toBe(200);
    expect(await read<{ card: { name: string }; latestPrice: unknown }>(res)).toMatchObject({ card: { name: "Snorlax" }, latestPrice: null });

    const patched = await PATCH(json("http://localhost/api/cards/1", "PATCH", { location: "Box A" }), ctx({ id: String(card.id) }) as never);
    expect((await read<{ card: { location: string } }>(patched)).card.location).toBe("Box A");
  });

  it("say so when the body is not JSON", async () => {
    const card = createCard({ game: "pokemon", name: "Snorlax" });
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const res = await PATCH(notJson("http://localhost/api/cards/1", "PATCH"), ctx({ id: String(card.id) }) as never);
    expect(res.status).toBe(400);
    expect((await read<{ error: string }>(res)).error).toMatch(/JSON body/);
  });

  it("report what the repository refused", async () => {
    const card = createCard({ game: "pokemon", name: "Snorlax" });
    const { PATCH } = await import("@/app/api/cards/[id]/route");
    const res = await PATCH(json("http://localhost/api/cards/1", "PATCH", { game: "wizards" }), ctx({ id: String(card.id) }) as never);
    expect(res.status).toBe(400);
    expect((await read<{ error: string }>(res)).error).toMatch(/Unknown game/);
  });
});

describe("alerts over HTTP", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("lists, counts, dismisses and marks read", async () => {
    const card = createCard({ game: "pokemon", name: "Snorlax" });
    createAlert({ kind: "price_move", cardId: card.id, title: "Up 20%", body: "…" });
    const second = createAlert({ kind: "ready_to_grade", cardId: card.id, title: "Ready", body: "…" });

    const alerts = await import("@/app/api/alerts/route");
    const listed = await read<{ alerts: unknown[]; unread: number }>(await alerts.GET());
    expect(listed.alerts).toHaveLength(2);
    expect(listed.unread).toBe(2);

    const one = await import("@/app/api/alerts/[id]/route");
    const dismissed = await one.DELETE(new Request("http://localhost/api/alerts/1", { method: "DELETE" }), ctx({ id: String(second.id) }) as never);
    expect(dismissed.status).toBe(200);
    expect((await read<{ unread: number }>(await alerts.GET())).unread).toBe(1);

    expect((await one.DELETE(new Request("http://localhost/api/alerts/x", { method: "DELETE" }), ctx({ id: "nope" }) as never)).status).toBe(404);

    const marked = await read<{ marked: number; unread: number }>(await alerts.POST());
    expect(marked).toMatchObject({ marked: 1, unread: 0 });
  });
});

describe("what the lookup routes refuse", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("will not price a game it does not know or a card with no name", async () => {
    const { POST } = await import("@/app/api/prices/lookup/route");
    expect((await POST(json("http://localhost/api/prices/lookup", "POST", { game: "wizards", name: "X" }))).status).toBe(400);
    expect((await POST(json("http://localhost/api/prices/lookup", "POST", { game: "pokemon", name: "  " }))).status).toBe(400);
    expect((await POST(notJson("http://localhost/api/prices/lookup", "POST"))).status).toBe(400);
  });

  it("does not let a prototype property pass as a game or a condition", async () => {
    // "constructor" is `in` every object. Let through, it would reach a price
    // lookup as a game, and `function Object() { [native code] }` would be
    // what the provider was asked about.
    const lookup = await import("@/app/api/prices/lookup/route");
    for (const game of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const res = await lookup.POST(json("http://localhost/api/prices/lookup", "POST", { game, name: "X" }));
      expect(res.status, game).toBe(400);
      expect(await res.text()).not.toContain("native code");
    }
    const condition = await lookup.POST(json("http://localhost/api/prices/lookup", "POST", { game: "pokemon", name: "X", condition: "constructor" }));
    expect(condition.status).toBe(400);
    expect((await read<{ error: string }>(condition)).error).toMatch(/condition/i);

    const cards = await import("@/app/api/cards/route");
    expect((await cards.GET(new Request("http://localhost/api/cards?game=constructor"))).status).toBe(400);
    expect((await cards.GET(new Request("http://localhost/api/cards?similar=1&game=constructor&name=X"))).status).toBe(400);

    const sets = await import("@/app/api/sets/refresh/route");
    expect((await sets.POST(json("http://localhost/api/sets/refresh", "POST", { game: "constructor", setName: "Base" }))).status).toBe(400);

    const csv = await import("@/app/api/import/route");
    expect((await csv.POST(json("http://localhost/api/import", "POST", { csv: "name\nX", game: "constructor" }))).status).toBe(400);
  });

  it("will not fetch a checklist for a game it does not know or a set with no name", async () => {
    const { POST } = await import("@/app/api/sets/refresh/route");
    expect((await POST(json("http://localhost/api/sets/refresh", "POST", { game: "wizards", setName: "Base" }))).status).toBe(400);
    expect((await POST(json("http://localhost/api/sets/refresh", "POST", { game: "pokemon", setName: " " }))).status).toBe(400);
  });

  it("will not identify nothing, too much, or a name it did not write", async () => {
    const { POST } = await import("@/app/api/identify/route");
    expect((await POST(json("http://localhost/api/identify", "POST", { uploads: [] }))).status).toBe(400);
    expect((await POST(json("http://localhost/api/identify", "POST", { uploads: ["a", "b", "c", "d", "e"] }))).status).toBe(400);
    const bad = await POST(json("http://localhost/api/identify", "POST", { uploads: ["../../etc/passwd"] }));
    expect(bad.status).toBe(400);
    expect((await read<{ error: string }>(bad)).error).toMatch(/Invalid upload name/);
    const missing = await POST(json("http://localhost/api/identify", "POST", { uploads: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg"] }));
    expect(missing.status).toBe(404);
  });

  it("serves an upload only under a name it wrote", async () => {
    const { GET } = await import("@/app/api/uploads/[name]/route");
    expect((await GET(new Request("http://localhost/api/uploads/x"), ctx({ name: "../../secrets.jpg" }) as never)).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/uploads/x"), ctx({ name: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg" }) as never)).status).toBe(404);
  });
});

describe("the collection routes", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("says so when the plain-text copy is switched off", async () => {
    process.env.MARKDOWN_MIRROR = "off";
    try {
      const { POST } = await import("@/app/api/collection/rebuild/route");
      const res = await POST();
      expect(res.status).toBe(409);
      expect((await read<{ error: string }>(res)).error).toMatch(/switched off/);
    } finally {
      delete process.env.MARKDOWN_MIRROR;
    }
  });

  it("has nothing to hand over when there are no cards", async () => {
    const { GET } = await import("@/app/api/collection/route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("streams a zip once there is something in it", async () => {
    createCard({ game: "pokemon", name: "Snorlax" });
    const { GET } = await import("@/app/api/collection/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("zip");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });
});

describe("where cards are kept", () => {
  beforeEach(() => setDb(openDatabase(":memory:")));

  it("lists every location in use, with a count", async () => {
    createCard({ game: "pokemon", name: "A", location: "Box A", quantity: 2 });
    createCard({ game: "pokemon", name: "B", location: "Box A" });
    createCard({ game: "pokemon", name: "C", location: "Binder 1" });
    createCard({ game: "pokemon", name: "D" });
    // A card with no copies left is not somewhere any more.
    const sold = createCard({ game: "pokemon", name: "E", location: "Box Z", quantity: 1 });
    recordSale(sold.id, { unitPrice: 5 });

    const { GET } = await import("@/app/api/locations/route");
    const { locations } = await read<{ locations: Array<{ location: string; cards: number }> }>(await GET());
    expect(locations).toEqual([
      { location: "Binder 1", cards: 1 },
      { location: "Box A", cards: 2 },
    ]);
  });
});
