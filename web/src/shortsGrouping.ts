import type { ClaudeRun, PlannedShort } from './api';

/** Keep active or failed work visible until it no longer needs attention. */
export function groupPlannedShorts(shorts: PlannedShort[], builds: Record<string, Pick<ClaudeRun, 'status'>>, making: string | null): { ready: PlannedShort[]; made: PlannedShort[] } {
  const ready: PlannedShort[] = []; const made: PlannedShort[] = [];
  for (const short of shorts) {
    const status = builds[short.id]?.status;
    (short.made && making !== short.id && status !== 'running' && status !== 'failed' ? made : ready).push(short);
  }
  return { ready, made };
}
