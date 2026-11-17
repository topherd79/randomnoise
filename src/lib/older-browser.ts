// Browsers older than Next.js 16 supports (Safari / iOS before 16.4). On an
// iPhone on iOS 16.2 the router's refresh froze the page (the answer was saved,
// then nothing ran again), so on these browsers the game reloads the page
// instead. Pure, so it can be unit tested.

/** Safari (or any iPhone/iPad browser, which all use the iOS version's Safari engine) before 16.4. */
export function isBelowSafari164(userAgent: string): boolean {
  // iPhone and iPad browsers, Chrome and Firefox included: "CPU iPhone OS 16_2_0 like Mac OS X".
  const ios = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)_(\d+)/.exec(userAgent);
  // Safari on a Mac (and iPads asking for the desktop site): "Version/16.2 Safari/605.1.15".
  const mac = ios ? null : /Chrome|Chromium|CriOS|FxiOS|Firefox|Edg\//.test(userAgent) ? null : /Version\/(\d+)\.(\d+).*\bSafari\//.exec(userAgent);
  const m = ios ?? mac;
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major < 16 || (major === 16 && minor < 4);
}

/** In the browser: whether to reload the page rather than use the router's refresh. */
export function needsPlainReload(): boolean {
  return typeof navigator !== "undefined" && isBelowSafari164(navigator.userAgent);
}
