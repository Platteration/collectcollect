import { priceJobs } from "@/lib/price-jobs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = priceJobs.get(id);
  return job ? Response.json({ job }) : Response.json({ error: "Refresh not found." }, { status: 404 });
}
