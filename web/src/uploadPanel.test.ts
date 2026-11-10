import { describe, expect, it } from 'vitest';
import { rememberUploadPanel, uploadPanelOpen } from './uploadPanel';

describe('upload panel preference', () => {
  it('remembers the open state separately for each video', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(uploadPanelOpen(storage, 'one')).toBe(false);
    rememberUploadPanel(storage, 'one', true);
    expect(uploadPanelOpen(storage, 'one')).toBe(true);
    expect(uploadPanelOpen(storage, 'two')).toBe(false);
    rememberUploadPanel(storage, 'one', false);
    expect(uploadPanelOpen(storage, 'one')).toBe(false);
  });
  it('keeps working if browser storage is unavailable', () => {
    const blocked = () => { throw new Error('blocked'); };
    expect(uploadPanelOpen({ getItem: blocked }, 'one')).toBe(false);
    expect(() => rememberUploadPanel({ setItem: blocked }, 'one', true)).not.toThrow();
  });
});
