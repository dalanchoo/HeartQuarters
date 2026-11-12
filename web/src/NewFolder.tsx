// The "+ New ..." buttons: ask for a name (with the next number filled in),
// then have the engine copy the right template folder and make a CapCut draft.
import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, type CreateResult, type NewKind } from './api';

const WHAT: Record<NewKind, { button: string; title: string }> = {
  top: { button: '+ New Video', title: 'New video project' },
  part: { button: '+ New Part', title: 'New part of this series' },
  short: { button: '+ New Short', title: 'New short for this video' },
  standalone: { button: '+ New Standalone Short', title: 'New standalone short' },
};

/** Where the new folder will go, e.g. "015 - NVC › 015B - Title › Longform". */
function whereItGoes(kind: NewKind, parent: string, name: string, seriesPart?: string): string {
  const n = name.trim() || '…';
  const parts =
    seriesPart !== undefined
      ? [n, seriesPart.trim() || '…', 'Longform']
      : kind === 'top'
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
  // Shorts only: which CapCut draft to copy ('' = the empty template).
  const [drafts, setDrafts] = useState<{ videoDrafts: string[]; otherDrafts: string[] } | null>(null);
  const [copyDraft, setCopyDraft] = useState('');
  // New video only: make it a series ("023 - Test") with a first part ("023A - ...").
  const [series, setSeries] = useState(false);
  const [partName, setPartName] = useState<string | null>(null); // null = not typed in yet
  const input = useRef<HTMLInputElement>(null);
  const partPrefix = `${/^(\d+)/.exec(name.trim())?.[1] ?? ''}A - `;
  const part = partName ?? partPrefix;

  // Fill in the next number ("023 - ") and put the cursor after it.
  useEffect(() => {
    type Suggestion = { prefix: string; videoDrafts?: string[]; otherDrafts?: string[] };
    getJson<Suggestion>(`/api/create/suggest?kind=${kind}&parent=${encodeURIComponent(parent)}`).then(
      (r) => {
        setPrefix(r.prefix);
        setName(r.prefix);
        if (r.videoDrafts && r.otherDrafts) {
          setDrafts({ videoDrafts: r.videoDrafts, otherDrafts: r.otherDrafts });
          setCopyDraft(r.videoDrafts[0] ?? ''); // usually: duplicate the long-form's draft
        }
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

  const ready =
    name.trim() !== '' &&
    name.trim() !== prefix?.trim() &&
    (!series || (part.trim() !== '' && part.trim() !== partPrefix.trim())) &&
    !busy;

  async function create() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = series
        ? await postJson<CreateResult>('/api/create/series', { name, partName: part })
        : await postJson<CreateResult>('/api/create', { kind, parent, name, copyDraft });
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
          {kind === 'top' && (
            <label className="checkbox small-text">
              <input type="checkbox" checked={series} disabled={busy} onChange={(e) => setSeries(e.target.checked)} />
              Make it a series (a folder of parts, like 015 - NVC)
            </label>
          )}
          {series && (
            <>
              <label className="muted small-text" htmlFor="new-folder-part">
                First part
              </label>
              <input
                id="new-folder-part"
                className="text-input"
                value={part}
                disabled={busy}
                onChange={(e) => setPartName(e.target.value)}
                onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
                spellCheck={false}
              />
            </>
          )}
          <p className="muted small-text">
            Will be made in: {whereItGoes(kind, parent, name, series ? part : undefined)}
          </p>
          {drafts ? (
            <>
              <label className="muted small-text" htmlFor="new-folder-draft">
                CapCut draft: make a copy of
              </label>
              <select
                id="new-folder-draft"
                className="text-input"
                value={copyDraft}
                disabled={busy}
                onChange={(e) => setCopyDraft(e.target.value)}
              >
                {drafts.videoDrafts.length > 0 && (
                  <optgroup label="This video's drafts">
                    {drafts.videoDrafts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="">Nothing: start with an empty draft</option>
                <optgroup label="All other drafts (newest first)">
                  {drafts.otherDrafts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </optgroup>
              </select>
              <p className="muted small-text">
                The copy is named after the short. A big draft can take a minute to copy.
              </p>
            </>
          ) : (
            <p className="muted small-text">
              An empty CapCut draft is made too, named after the {series ? 'first part' : 'video'}.
            </p>
          )}
          {error && <p className="error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="small" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={!ready}>
              {busy ? (copyDraft ? 'Copying…' : 'Making…') : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
