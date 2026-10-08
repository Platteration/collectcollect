import { NextResponse } from "next/server";
import { realizedReturn } from "@/lib/analytics";
import { listSales } from "@/lib/sales";

export async function GET() {
  const sales = listSales();
  return NextResponse.json({ sales, realized: realizedReturn(sales) });
}
