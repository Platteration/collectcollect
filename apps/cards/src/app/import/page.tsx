import { ImportForm } from "@/components/ImportForm";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Import a collection</h1>
        <p className="max-w-2xl text-sm text-neutral-500">
          Bring in a spreadsheet you already keep, or an export from another collection tool. Columns are matched by
          name, so a file with headers like “Card Name”, “Edition” or “Qty” usually needs no editing. Nothing is written
          until you have seen what was understood.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
