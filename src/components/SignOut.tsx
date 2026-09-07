"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-black/5 dark:text-neutral-300 dark:hover:bg-white/10"
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
