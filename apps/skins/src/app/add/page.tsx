import Link from "next/link";
import { listStorageUnits } from "@/lib/items";
import { AddItemForm } from "@/components/AddItemForm";

export const dynamic = "force-dynamic";

export default function AddPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Add an item</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          One at a time. For a whole inventory,{" "}
          <Link href="/import" className="underline">
            import it
          </Link>{" "}
          instead.
        </p>
      </header>
      <AddItemForm storageUnits={listStorageUnits().map((u) => u.storageUnit)} />
    </div>
  );
}
