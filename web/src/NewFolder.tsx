// The "+ New ..." buttons: ask for a name (with the next number filled in),
// then have the engine copy the right template folder and make a CapCut draft.
import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, type CreateResult, type NewKind } from './api';

const WHAT: Record<NewKind, { button: string; title: string }> = {
  top: { button: '+ New video', title: 'New video project' },
  part: { button: '+ New part', title: 'New part of this series' },
  short: { button: '+ New short', title: 'New short for this video' },
  standalone: { button: '+ New standalone short', title: 'New standalone short' },
};

/** Where the new folder will go, e.g. "015 - NVC › 015B - Title › Longform". */
function whereItGoes(kind: NewKind, parent: string, name: string): string {
  const n = name.trim() || '…';
  const parts =
    kind === 'top'
      ? [n, 'Longform']
      : kind === 'part'
        ? [parent, n, 'Longform']
        : kind === 'short'
          ? [parent, 'Shorts', n]
          : ['999 - Shorts', String(new Date().getFullYear()), n];
  return ['Video Projects', ...parts].join(' › ').replaceAll('/', ' › ');
}

export function NewFolderButton({
  kind,
  parent = '',
  onCreated,
}: {
  kind: NewKind;
  parent?: string;
  onCreated: (result: CreateResult) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="small" onClick={() => setOpen(true)}>
        {WHAT[kind].button}
      </button>
      {open && <NewFolderDialog kind={kind} parent={parent} onCreated={onCreated} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewFolderDialog({
  kind,
  parent,
  onCreated,
  onClose,
}: {
  kind: NewKind;
  parent: string;
  onCreated: (result: CreateResult) => void;
  onClose: () => void;
}) {
  const [prefix, setPrefix] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Fill in the next number ("023 - ") and put the cursor after it.
  useEffect(() => {
    getJson<{ prefix: string }>(`/api/create/suggest?kind=${kind}&parent=${encodeURIComponent(parent)}`).then(
      (r) => {
        setPrefix(r.prefix);
        setName(r.prefix);
      },
      (e) => setError(e.message),
    );
  }, [kind, parent]);

  useEffect(() => {
    if (prefix === null) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [prefix]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const ready = name.trim() !== '' && name.trim() !== prefix?.trim() && !busy;

  async function create() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<CreateResult>('/api/create', { kind, parent, name });
      onClose();
      onCreated(result); // shows the new folder, with a note about the CapCut draft
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <h3>{WHAT[kind].title}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="muted small-text" htmlFor="new-folder-name">
            Name
          </label>
          <input
            id="new-folder-name"
            ref={input}
            className="text-input"
            value={name}
            disabled={prefix === null || busy}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
          />
          <p className="muted small-text">Will be made in: {whereItGoes(kind, parent, name)}</p>
          <p className="muted small-text">A CapCut draft with the same name is made too.</p>
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="small" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={!ready}>
              {busy ? 'Making…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
