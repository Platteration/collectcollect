import { describe, expect, it } from "vitest";
import { engine } from "@/lib/engine";
import { spec } from "@/lib/spec";

describe("the __SINGULAR__ schema", () => {
  it("needs a name", () => {
    expect(() => engine.repo.normalize({ name: " " })).toThrow(/Name/);
  });

  it("keeps a serial number private", () => {
    expect(spec.fields.find((f) => f.key === "serial")?.private).toBe(true);
  });
});

describe("one specific object or a stack", () => {
  it("stacks identical copies and keeps signed ones apart", () => {
    const a = engine.repo.intakeItem({ name: "Example", maker: "Acme", quantity: 1 });
    const b = engine.repo.intakeItem({ name: "Example", maker: "Acme", quantity: 2 });
    expect(a.result).toBe("created");
    expect(b.result).toBe("merged");
    expect(engine.repo.listItems()).toHaveLength(1);
    expect(engine.repo.listItems()[0].quantity).toBe(3);

    const c = engine.repo.intakeItem({ name: "Example", maker: "Acme", signed: true });
    const d = engine.repo.intakeItem({ name: "Example", maker: "Acme", signed: true });
    expect(c.result).toBe("created");
    expect(d.result).toBe("created");
    expect(engine.repo.listItems()).toHaveLength(3);
  });
});

describe("pricing", () => {
  it("records a value entered by hand and draws it on the chart", () => {
    const item = engine.repo.createItem({ name: "Example", maker: "Acme" });
    engine.refresh.addManualSnapshot(item.id, { value: 120, at: "2024-01-01" });
    engine.refresh.addManualSnapshot(item.id, { value: 150, at: "2024-06-01" });
    const latest = engine.repo.latestSnapshot(item.id);
    expect(latest?.summary.yourCopyValue).toBe(150);
    expect(engine.valuation(item, latest).value).toBe(150);
  });
});
