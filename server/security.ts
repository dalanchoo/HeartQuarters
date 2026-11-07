// Protects HeartQuarters from other websites open in your browser.
//
// The app only listens on 127.0.0.1, so other devices can't reach it. But a
// web page you visit runs inside your browser on this PC, and could try to
// send requests to http://127.0.0.1:4321. Two defences:
//
// 1. Host check: only answer requests addressed to 127.0.0.1 or localhost.
//    This stops "DNS rebinding", where a website points its own name at
//    127.0.0.1 to look like HeartQuarters.
// 2. Action check: anything that does something (POST etc.) must come from
//    HeartQuarters' own pages and carry the X-HeartQuarters header. Browsers
//    won't let another website add that header without permission, which we
//    never give.
import type { NextFunction, Request, Response } from 'express';

export const ACTION_HEADER = 'x-heartquarters';

const LOCAL_HOST_RE = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const LOCAL_ORIGIN_RE = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

/** True if the request was addressed to this PC by name or number. */
export function isLocalHost(host: string | undefined): boolean {
  return !!host && LOCAL_HOST_RE.test(host);
}

/** True if a request came from one of HeartQuarters' own pages (or has no Origin at all). */
export function isLocalOrigin(origin: string | undefined): boolean {
  return origin === undefined || LOCAL_ORIGIN_RE.test(origin);
}

export function guard(req: Request, res: Response, next: NextFunction) {
  if (!isLocalHost(req.headers.host)) {
    res.status(403).send('HeartQuarters only answers requests addressed to this PC.');
    return;
  }
  const isAction = req.method !== 'GET' && req.method !== 'HEAD';
  if (isAction && (!isLocalOrigin(req.headers.origin) || req.headers[ACTION_HEADER] !== '1')) {
    res.status(403).json({ error: 'Blocked: this request did not come from HeartQuarters.' });
    return;
  }
  next();
}

/**
 * Headers for files served from your folders. "sandbox" means that if a file
 * is an HTML or SVG page with code in it, the browser shows it but won't let
 * that code act as HeartQuarters.
 */
export function sandboxHeaders(res: Response) {
  res.set('Content-Security-Policy', 'sandbox');
  res.set('X-Content-Type-Options', 'nosniff');
}
