import { NextResponse } from "next/server";
import { listLocations } from "@/lib/cards";

/** GET — the storage locations already in use, for autocomplete. */
export async function GET() {
  return NextResponse.json({ locations: listLocations() });
}
