import { NextResponse } from "next/server";
import { listScanDrafts } from "@/lib/scan-drafts";

export function GET() { return NextResponse.json({ drafts: listScanDrafts() }); }
