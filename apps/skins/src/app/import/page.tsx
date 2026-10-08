import { CsvImport } from "@/components/CsvImport";
import { SteamImport } from "@/components/SteamImport";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-display text-2xl font-semibold uppercase tracking-wide">Bring an inventory in</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Either way, nothing is written until you have seen what would arrive.
        </p>
      </header>

      <div>
        <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">From Steam</h2>
        <SteamImport />
      </div>

      <div>
        <h2 className="font-display mb-3 text-lg font-semibold uppercase tracking-wide">From a spreadsheet</h2>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          This is the one that knows what you paid. Steam does not, so a file of
          your own purchases is what turns an inventory into a record.
        </p>
        <CsvImport />
      </div>
    </div>
  );
}
