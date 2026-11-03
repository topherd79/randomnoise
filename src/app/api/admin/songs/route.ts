import { adminForRoute } from "@/lib/auth";
import { ingestUpload } from "@/lib/catalog";
import { receiveUpload } from "@/lib/uploads";

/**
 * Add one song to the catalog. The admin page uploads a folder one file per
 * request: the body is the file itself and X-File-Name carries its name.
 */
export async function POST(request: Request) {
  const admin = await adminForRoute();
  if (admin instanceof Response) return admin;

  const received = await receiveUpload(request);
  if ("error" in received) return Response.json({ ok: false, error: received.error }, { status: received.status });

  const result = await ingestUpload(received);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
