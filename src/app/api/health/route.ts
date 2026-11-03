// Railway pings this after each deploy to know the app started.
export function GET() {
  return Response.json({ ok: true });
}
