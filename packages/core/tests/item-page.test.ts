import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { widgetEngine } from "./widgets";

// The page is a server component that sits in a Next app; what it needs of
// the router is only that the client components under it can ask for one.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/",
}));

const { ItemPage } = await import("../src/pages/ItemPage");

let engine: ReturnType<typeof widgetEngine>;
beforeEach(() => {
  engine = widgetEngine();
});

const priced = (at: string, value: number) => ({ currency: "USD" as const, fetchedAt: at, yourCopyValue: value, yourCopyBasis: "t", quotes: [], errors: [], market: value, marketSource: "t" });
const draw = async (id: number) => renderToStaticMarkup(await ItemPage({ engine, params: Promise.resolve({ id: String(id) }) }));

describe("an item's page", () => {
  it("draws its value history green unless the newest value is below the oldest", async () => {
    const rising = engine.repo.createItem({ name: "Rising" });
    engine.repo.addSnapshot(rising.id, priced("2026-01-01T00:00:00.000Z", 10));
    engine.repo.addSnapshot(rising.id, priced("2026-02-01T00:00:00.000Z", 12));
    const falling = engine.repo.createItem({ name: "Falling" });
    engine.repo.addSnapshot(falling.id, priced("2026-01-01T00:00:00.000Z", 10));
    engine.repo.addSnapshot(falling.id, priced("2026-02-01T00:00:00.000Z", 14));
    engine.repo.addSnapshot(falling.id, priced("2026-03-01T00:00:00.000Z", 8));
    const flat = engine.repo.createItem({ name: "Flat" });
    engine.repo.addSnapshot(flat.id, priced("2026-01-01T00:00:00.000Z", 10));
    engine.repo.addSnapshot(flat.id, priced("2026-02-01T00:00:00.000Z", 10));

    expect(await draw(rising.id)).toContain('stroke="var(--chart-good)"');
    expect(await draw(flat.id)).toContain('stroke="var(--chart-good)"');
    const html = await draw(falling.id);
    expect(html).toContain('stroke="var(--chart-bad)"');
    expect(html).not.toContain('stroke="var(--chart-good)"');
  });

  it("draws one value as no fall, and no chart at all for none", async () => {
    const one = engine.repo.createItem({ name: "One" });
    engine.repo.addSnapshot(one.id, priced("2026-01-01T00:00:00.000Z", 10));
    const none = engine.repo.createItem({ name: "None" });
    const html = await draw(one.id);
    expect(html).toContain("var(--chart-good)");
    expect(html).not.toContain("var(--chart-bad)");
    expect(await draw(none.id)).not.toContain("Value over time");
  });
});
