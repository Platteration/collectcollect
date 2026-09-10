"use client";

import { useRouter } from "next/navigation";
import { api } from "../api-client";

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-raised)]"
      style={{ color: "var(--muted)" }}
      onClick={async () => {
        await api("/api/auth", { method: "DELETE" }).catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
