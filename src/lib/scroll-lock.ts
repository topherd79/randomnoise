// Holding the page still behind a side panel, iPhones included.
//
// `overflow: hidden` on the body isn't enough on an iPhone: once the keyboard is
// up, Safari lets a drag move the whole visible area over the page, so the page
// behind the panel slides around. So while a panel is open:
// - the body is pinned in place (`position: fixed`, shifted up by how far the
//   page was scrolled, so nothing visibly moves), and put back on close;
// - a drag anywhere but inside one of the panel's scrolling lists
//   (`data-panel-scroll`) does nothing, and so does a drag that would push a list
//   past its top or bottom (that's when Safari would move the page instead);
// - in the message box, a drag that starts moving straight away does nothing
//   too; one that starts with the finger held still is moving the cursor (the
//   magnifier), and is left alone.
// Pure logic first so it can be unit tested.

export type ScrollBox = { scrollTop: number; scrollHeight: number; clientHeight: number };

/**
 * Whether a drag (`dy` px, positive = finger moving down, which scrolls toward
 * the top) inside a scrolling list must be stopped: when the list can't scroll
 * any further that way, the drag would move the page instead.
 */
export function blocksDrag(box: ScrollBox, dy: number): boolean {
  if (dy === 0) return false;
  const atTop = box.scrollTop <= 0;
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
  return dy > 0 ? atTop : atBottom;
}

/** How long a finger rests on the message box before moving for it to be moving the cursor, not dragging. */
export const CURSOR_HOLD_MS = 300;

/** A touch in the message box that held still this long before moving: moving the cursor, not the page. */
export function movesCursor(heldMs: number): boolean {
  return heldMs >= CURSOR_HOLD_MS;
}

/** Marks a panel's scrolling list: drags inside it scroll it. */
export const PANEL_SCROLL = { "data-panel-scroll": "" } as const;

/** Hold the page still until the returned function is called. */
export function lockPageScroll(): () => void {
  const root = document.documentElement;
  const body = document.body;
  const y = window.scrollY;
  const saved = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
    overscroll: root.style.overscrollBehavior,
  };
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
  root.style.overscrollBehavior = "none";

  let lastY = 0;
  let startedAt = 0;
  /** In the message box, decided on a touch's first move and kept for the rest of it. */
  let cursor: boolean | null = null;
  const onStart = (e: TouchEvent) => {
    lastY = e.touches[0]?.clientY ?? 0;
    startedAt = e.timeStamp;
    cursor = null;
  };
  const onMove = (e: TouchEvent) => {
    // Two fingers: a pinch to zoom, left alone.
    if (e.touches.length !== 1) return;
    const y1 = e.touches[0].clientY;
    const dy = y1 - lastY;
    lastY = y1;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("input, textarea")) {
      cursor ??= movesCursor(e.timeStamp - startedAt);
      if (!cursor) e.preventDefault();
      return;
    }
    const list = target?.closest<HTMLElement>("[data-panel-scroll]");
    if (!list || blocksDrag(list, dy)) e.preventDefault();
  };
  document.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: false });

  return () => {
    document.removeEventListener("touchstart", onStart);
    document.removeEventListener("touchmove", onMove);
    body.style.position = saved.position;
    body.style.top = saved.top;
    body.style.left = saved.left;
    body.style.right = saved.right;
    body.style.width = saved.width;
    body.style.overflow = saved.overflow;
    root.style.overscrollBehavior = saved.overscroll;
    window.scrollTo(0, y);
  };
}
