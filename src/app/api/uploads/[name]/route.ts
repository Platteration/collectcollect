import { isValidUploadName, readUpload } from "@/lib/images";

export async function GET(_request: Request, ctx: RouteContext<"/api/uploads/[name]">) {
  const { name } = await ctx.params;
  if (!isValidUploadName(name)) return new Response("Not found", { status: 404 });
  const data = await readUpload(name);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      // The bytes came from a client, but every upload is re-encoded to JPEG on
      // the way in, so this type is the app's own rather than the uploader's.
      // `nosniff` is not repeated here: next.config.ts sets it on every
      // response including this one, and e2e/access.spec.ts pins it here.
      "Content-Type": "image/jpeg",
      // A stored upload never changes: the name is a fresh UUID each time.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
