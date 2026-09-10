import { NextResponse } from "next/server";
import { listStorageUnits } from "@/lib/items";

/** GET — the storage units in use, for autocomplete. */
export async function GET() {
  return NextResponse.json({ storageUnits: listStorageUnits() });
}
