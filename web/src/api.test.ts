import { afterEach, describe, expect, it, vi } from 'vitest';
import { replaceHash } from './api';

describe('replaceHash', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates history and dispatches hq-hash-replace when hash changes', () => {
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('location', { hash: '#Chat/old' });
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('Event', class { constructor(public type: string) {} });

    replaceHash('#Chat/new');

    expect(replaceState).toHaveBeenCalledWith(null, '', '#Chat/new');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as { type: string }).type).toBe('hq-hash-replace');
  });

  it('does nothing when the hash already matches', () => {
    const replaceState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('location', { hash: '#Chat/same' });
    vi.stubGlobal('history', { replaceState });
    vi.stubGlobal('window', { dispatchEvent });

    replaceHash('#Chat/same');

    expect(replaceState).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
