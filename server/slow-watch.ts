// Says so in the engine window when something makes HeartQuarters wait: a request that takes over a second,
// or the whole engine being stuck. Nothing is changed or stopped; it only prints.
import type { NextFunction, Request, Response } from 'express';

export const SLOW_MS = 1000;
type Log = (line: string) => void;

/** Prints one line when a request took longer than the limit. */
export function slowRequestLogger(log: Log = console.log, limitMs = SLOW_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', () => {
      const took = Date.now() - started;
      if (took > limitMs) log(`[slow] ${req.method} ${req.originalUrl.split('?')[0]} took ${(took / 1000).toFixed(1)} s`);
    });
    next();
  };
}

/** Prints one line when the engine was stuck (could answer nothing) for longer than the limit. */
export function watchEngineStalls(log: Log = console.log, limitMs = SLOW_MS, everyMs = 250): NodeJS.Timeout {
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const stuck = now - last - everyMs;
    last = now;
    if (stuck > limitMs) log(`[slow] The engine was stuck for ${(stuck / 1000).toFixed(1)} s (something blocked it).`);
  }, everyMs);
  timer.unref();
  return timer;
}
