// The handle on the right edge of the left column: drag it to make the column wider or narrower. The arrow keys
// work too when it has focus, and a double-click goes back to the standard width. One width for every page,
// remembered in this browser.
import { useEffect, useRef } from 'react';

const KEY = 'hq-sidebar-width';
export const SIDEBAR_DEFAULT = 290;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 700;

/** Keeps a width within the allowed range (and never wider than most of the window). */
export function clampSidebarWidth(width: number, windowWidth = Infinity): number {
  const max = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, windowWidth - 360));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, Number.isFinite(width) ? width : SIDEBAR_DEFAULT)));
}

function current(): number {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
  return Number.isFinite(value) ? value : SIDEBAR_DEFAULT;
}

function apply(width: number, save: boolean) {
  const w = clampSidebarWidth(width, window.innerWidth);
  document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  if (save) { try { localStorage.setItem(KEY, String(w)); } catch { /* only a convenience */ } }
  return w;
}

/** Puts back the width chosen last time. Called once when the app starts. */
export function restoreSidebarWidth() {
  let saved = NaN;
  try { saved = Number(localStorage.getItem(KEY)); } catch { /* only a convenience */ }
  if (saved) apply(saved, false);
}

export function SidebarResizer() {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const setAria = (w: number) => handle.current?.setAttribute('aria-valuenow', String(w));
  useEffect(() => { setAria(current()); }, []);
  return <div ref={handle} className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize the left column" aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} tabIndex={0}
    title="Drag to make the left column wider or narrower. Double-click for the standard width."
    onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); drag.current = { x: e.clientX, width: current() }; e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('is-resizing-sidebar'); }}
    onPointerMove={e => { const d = drag.current; if (d) setAria(apply(d.width + e.clientX - d.x, false)); }}
    onPointerUp={() => { if (!drag.current) return; drag.current = null; document.body.classList.remove('is-resizing-sidebar'); apply(current(), true); }}
    onPointerCancel={() => { drag.current = null; document.body.classList.remove('is-resizing-sidebar'); }}
    onDoubleClick={() => setAria(apply(SIDEBAR_DEFAULT, true))}
    onKeyDown={e => { const step = e.shiftKey ? 50 : 10; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setAria(apply(current() + (e.key === 'ArrowRight' ? step : -step), true)); } }}
  />;
}
