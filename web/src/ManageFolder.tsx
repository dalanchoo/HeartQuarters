// Rename and Delete buttons for a video folder, each with a confirmation box.
// Delete moves things to the trash folder (see server/manage.ts); nothing is
// really deleted.
import { useEffect, useRef, useState } from 'react';
import { formatSize, getJson, postJson, type ManageInfo, type ManageResult } from './api';

type Mode = 'rename' | 'delete';

export function ManageButtons({ path, onDone }: { path: string; onDone: (r: ManageResult) => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <>
      <button className="small" onClick={() => setMode('rename')}>
        Rename
      </button>
      <button className="small danger-outline" onClick={() => setMode('delete')}>
        Delete
      </button>
      {mode && <ManageDialog mode={mode} path={path} onDone={onDone} onClose={() => setMode(null)} />}
    </>
  );
}

function ManageDialog({
  mode,
  path,
  onDone,
  onClose,
}: {
  mode: Mode;
  path: string;
  onDone: (r: ManageResult) => void;
  onClose: () => void;
}) {
  const [info, setInfo] = useState<ManageInfo | null>(null);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  function load() {
    getJson<ManageInfo>(`/api/manage/info?path=${encodeURIComponent(path)}`).then(
      (i) => {
        // First load: fill in the name and tick all the drafts. ("Check again" keeps your choices.)
        if (!loaded.current) {
          loaded.current = true;
          setName(i.name);
          setDrafts(mode === 'rename' ? i.ownDrafts : i.allDrafts);
        }
        setInfo(i);
      },
      (e) => setError(e.message),
    );
  }
  useEffect(load, [path, mode]);

  useEffect(() => {
    if (!info || mode !== 'rename') return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [info === null]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const offered = info ? (mode === 'rename' ? info.ownDrafts : info.allDrafts) : [];
  const needsCapCutClosed = mode === 'rename' || drafts.length > 0;
  const blockedByCapCut = !!info?.capcutRunning && needsCapCutClosed;
  const ready =
    !!info &&
    !busy &&
    !blockedByCapCut &&
    (mode === 'rename' ? name.trim() !== '' && name.trim() !== info.name : sure);

  async function go() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r =
        mode === 'rename'
          ? await postJson<ManageResult>('/api/manage/rename', { path, newName: name, drafts })
          : await postJson<ManageResult>('/api/manage/delete', { path, drafts });
      onClose();
      onDone(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const toggle = (d: string) => setDrafts((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]));

  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <h3>{mode === 'rename' ? 'Rename' : 'Delete'}</h3>
        {!info && !error && <p className="muted">Loading…</p>}
        {info && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void go();
            }}
          >
            {mode === 'rename' ? (
              <>
                <label className="muted small-text" htmlFor="rename-name">
                  New name
                </label>
                <input
                  id="rename-name"
                  ref={input}
                  className="text-input"
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  spellCheck={false}
                />
              </>
            ) : (
              <p>
                Move <strong>{info.name}</strong> to the trash?{' '}
                <span className="muted">
                  ({info.files} file{info.files === 1 ? '' : 's'}, {formatSize(info.bytes)})
                </span>
              </p>
            )}

            {offered.length > 0 ? (
              <>
                <p className="muted small-text">
                  {mode === 'rename' ? 'Also rename these CapCut drafts:' : 'Also move these CapCut drafts to the trash:'}
                </p>
                {offered.map((d) => (
                  <label key={d} className="checkbox small-text">
                    <input type="checkbox" checked={drafts.includes(d)} disabled={busy} onChange={() => toggle(d)} />
                    {d}
                  </label>
                ))}
              </>
            ) : (
              <p className="muted small-text">No CapCut draft with this name was found.</p>
            )}

            {mode === 'rename' ? (
              <p className="muted small-text">
                Links inside CapCut drafts that use files from this folder are updated to the new name.
              </p>
            ) : (
              <>
                <p className="muted small-text">
                  Nothing is really deleted: it's moved to {info.trashDir}. To undo, move it back from there.
                </p>
                <label className="checkbox">
                  <input type="checkbox" checked={sure} disabled={busy} onChange={(e) => setSure(e.target.checked)} />
                  Yes, I'm sure
                </label>
              </>
            )}

            {blockedByCapCut && (
              <p className="warn">
                CapCut is open. Close CapCut, then click Check again. (If CapCut is open, it can save its old copy of a draft and wipe out the change.){' '}
                <button type="button" className="small" onClick={load}>
                  Check again
                </button>
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="small" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={mode === 'delete' ? 'danger' : ''} disabled={!ready}>
                {busy ? 'Working…' : mode === 'rename' ? 'Rename' : 'Move to trash'}
              </button>
            </div>
          </form>
        )}
        {!info && error && (
          <>
            <p className="error">{error}</p>
            <div className="modal-actions">
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
