import { isValidUploadName, readUpload } from "@/lib/images";

/** GET — the photo, or with `?size=thumb` the small copy the grid shows. */
export async function GET(request: Request, ctx: RouteContext<"/api/uploads/[name]">) {
  const { name } = await ctx.params;
  if (!isValidUploadName(name)) return new Response("Not found", { status: 404 });
  const size = new URL(request.url).searchParams.get("size") ?? "full";
  if (size !== "full" && size !== "thumb") return new Response("Unknown size; use full or thumb", { status: 400 });
  const data = await readUpload(name, size);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
