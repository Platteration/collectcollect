import { isValidUploadName, readUpload } from "@/lib/images";

export async function GET(_request: Request, ctx: RouteContext<"/api/uploads/[name]">) {
  const { name } = await ctx.params;
  if (!isValidUploadName(name)) return new Response("Not found", { status: 404 });
  const data = await readUpload(name);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      // The bytes came from a client. Every upload is re-encoded to JPEG, but
      // the browser should not be guessing at the type either way.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
