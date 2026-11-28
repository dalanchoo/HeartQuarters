const KEY = 'hq-chat-compose-height';
export const COMPOSE_DEFAULT_HEIGHT = 96;
export const COMPOSE_MIN_HEIGHT = 40;
export const COMPOSE_MAX_HEIGHT = 600;

/** Keeps the chat composer height within the allowed range for the current window. */
export function clampComposeHeight(height: number, windowHeight = Infinity): number {
  const max = Math.min(COMPOSE_MAX_HEIGHT, Math.max(COMPOSE_MIN_HEIGHT, Math.round(windowHeight * 0.6)));
  return Math.round(Math.min(max, Math.max(COMPOSE_MIN_HEIGHT, Number.isFinite(height) ? height : COMPOSE_DEFAULT_HEIGHT)));
}

export function loadComposeHeight(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampComposeHeight(n, window.innerHeight) : null;
  } catch {
    return null;
  }
}

export function saveComposeHeight(height: number | null): void {
  try {
    if (height == null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(height));
  } catch {
    /* only a convenience */
  }
}
