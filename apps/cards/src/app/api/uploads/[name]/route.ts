import { isValidUploadName, readUpload } from "@/lib/images";

/**
 * A refusal is no-store like every other API answer: this route is on the
 * proxy's `cachedPaths` for the photo's own sake, and that leaves its errors to
 * say their own caching or say none.
 */
const refusal = (status: number, message: string) => new Response(message, { status, headers: { "Cache-Control": "no-store" } });

/** GET — the photo, or with `?size=thumb` the small copy the grid shows. */
export async function GET(request: Request, ctx: RouteContext<"/api/uploads/[name]">) {
  const { name } = await ctx.params;
  if (!isValidUploadName(name)) return refusal(404, "Not found");
  const size = new URL(request.url).searchParams.get("size") ?? "full";
  if (size !== "full" && size !== "thumb") return refusal(400, "Unknown size; use full or thumb");
  const data = await readUpload(name, size);
  if (!data) return refusal(404, "Not found");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
