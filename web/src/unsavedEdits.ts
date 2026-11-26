import { useEffect, useRef, useState } from 'react';

const pending = new Set<symbol>();

/** Tracks in-memory edits so navigating to another project can warn before unmounting them. */
export function setPendingEdit(id: symbol, dirty: boolean) {
  if (dirty) pending.add(id); else pending.delete(id);
}

export function hasPendingEdits() { return pending.size > 0; }

/**
 * While `dirty`, counts as a pending edit and makes the browser ask before a refresh or closing the tab
 * (the browser shows its own wording, which can't be changed).
 */
export function useUnsavedWarning(dirty: boolean) {
  const id = useRef(Symbol('edit'));
  useEffect(() => {
    if (!dirty) return;
    const key = id.current;
    setPendingEdit(key, true);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => { setPendingEdit(key, false); window.removeEventListener('beforeunload', warn); };
  }, [dirty]);
}

/** How long typing has to pause before a text field saves itself. */
export const AUTOSAVE_DELAY = 1000;

/**
 * A text field that saves itself a moment after typing stops, the way the dropdowns save at once.
 * `saved` is the value the server has. It replaces what's typed only when it changed somewhere else
 * (for example Add to Notes), never when it's just the answer to this field's own save.
 * Anything not yet saved is saved when the field goes away, and the browser asks before a refresh.
 */
export function useAutosavedText(
  saved: string,
  save: (value: string) => Promise<unknown>,
  canSave: (value: string) => boolean = () => true,
) {
  const [value, setValue] = useState(saved);
  const sent = useRef(saved);
  const latest = useRef({ value, save, canSave });
  latest.current = { value, save, canSave };

  useEffect(() => {
    if (saved !== sent.current) { sent.current = saved; setValue(saved); }
  }, [saved]);

  const dirty = value !== saved;
  useUnsavedWarning(dirty);

  const flush = () => {
    const { value: now, save: run, canSave: ok } = latest.current;
    if (now === sent.current || !ok(now)) return;
    sent.current = now;
    // If the save fails, the text stays highlighted and the next keystroke tries again.
    void run(now).then((done) => { if (done === false && sent.current === now) sent.current = '\u0000unsaved'; });
  };

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(flush, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [value, dirty]);

  // Closing the page section (or the app switching ideas) keeps what was typed.
  useEffect(() => () => flush(), []);

  return { value, setValue, dirty, flush };
}
