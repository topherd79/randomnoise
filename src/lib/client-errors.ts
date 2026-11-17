// Browser side: send a script error to the server's log (/api/client-error), so a
// failure on someone's phone (an older iPhone, say) shows up in Railway's logs.

let sent = 0;
const MAX_PER_PAGE = 5;

export function reportClientError(where: string, err: unknown): void {
  if (typeof window === "undefined" || sent >= MAX_PER_PAGE) return;
  sent += 1;
  const e = err instanceof Error ? err : null;
  const body = JSON.stringify({
    where,
    message: e ? `${e.name}: ${e.message}` : String(err),
    stack: e?.stack ?? "",
    url: window.location.pathname,
  });
  try {
    fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(
      () => {},
    );
  } catch {
    // Reporting must never cause an error of its own.
  }
}
