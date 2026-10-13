import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openDatabase, setDb } from "@/lib/db";
import { createCard } from "@/lib/cards";
import { dismissSetup, setupStatus } from "@/lib/setup";
import { accessStep } from "@/components/SetupChecklist";
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
it("says which way in the gate offers, and calls sign-in with Google alone no password", () => {
  const line = () => accessStep(setupStatus());
  vi.stubEnv("APP_PASSWORD", "");
  expect(setupStatus()).toMatchObject({ passwordSet: false, googleSignIn: false });
  expect(line()).toBe("3. Local access: password not set");
  vi.stubEnv("APP_URL", "https://cards.example");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("GOOGLE_ALLOWED_SUBS", "1001");
  expect(setupStatus()).toMatchObject({ passwordSet: false, googleSignIn: true });
  expect(line()).toBe("✓ Sign-in with Google required");
  vi.stubEnv("APP_PASSWORD", "hunter2");
  expect(line()).toBe("✓ Sign-in required: a password or Google");
  vi.stubEnv("GOOGLE_ALLOWED_SUBS", "");
  expect(setupStatus()).toMatchObject({ passwordSet: true, googleSignIn: false });
  expect(line()).toBe("✓ Password protection enabled");
});
