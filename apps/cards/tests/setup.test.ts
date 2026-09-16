import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { dismissSetup, setupStatus } from "@/lib/setup";
beforeEach(() => setDb(openDatabase(":memory:")));
afterEach(() => vi.unstubAllEnvs());
it("dismisses and reopens setup without changing collection settings", () => {
  expect(setupStatus()).toMatchObject({ dismissed: false, hasCards: false });
  createCard({ game: "pokemon", name: "First card" });
  dismissSetup(true);
  expect(setupStatus()).toMatchObject({ dismissed: true, hasCards: true });
  dismissSetup(false);
  expect(setupStatus()).toMatchObject({ dismissed: false, hasCards: true });
});
it("does not read even an existing collection while building", () => {
  createCard({ game: "pokemon", name: "Private card" }); dismissSetup(true);
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  expect(setupStatus()).toMatchObject({ dismissed: false, hasCards: false });
});
