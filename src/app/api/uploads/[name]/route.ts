import { isValidUploadName, readUpload } from "@/lib/images";

export async function GET(_request: Request, ctx: RouteContext<"/api/uploads/[name]">) {
  const { name } = await ctx.params;
  if (!isValidUploadName(name)) return new Response("Not found", { status: 404 });
  const data = await readUpload(name);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
