import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { IdeaFormat, IdeaReference, IdeaStatus, VideoIdea } from '../../server/video-ideas';

// The Ideas tab: John's own list of videos he might make, kept in Video Projects\Video Ideas.json.
// Raw brain dumps stay in Raw; once turned into a clear idea they move to Processed.
// The order is his: the top is what he'd make next.
export const STATUS_LABELS: Record<IdeaStatus, string> = {
  thinking: 'Thinking About It',
  researching: 'Researching',
  packaged: 'Packaged',
  filming: 'Filming',
  made: 'Made',
  dropped: 'Dropped',
};
const FINISHED: IdeaStatus[] = ['made', 'dropped'];
export const FORMAT_LABELS: Record<IdeaFormat, string> = { undecided: 'Undecided', longform: 'Longform', short: 'Short' };

export function IdeasPage() {
  const [ideas, setIdeas] = useState<VideoIdea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => getJson<VideoIdea[]>('/api/ideas').then(setIdeas, (e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  /** Send one change; the server replies with the whole updated list. */
  const send = async (url: string, data: unknown) => {
    setBusy(true); setError(null);
    try { setIdeas(await postJson<VideoIdea[]>(url, data)); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!title.trim()) return;
    if (await send('/api/ideas/add', { title })) setTitle('');
  };

  const all = ideas ?? [];
  const visible = (idea: VideoIdea) => showFinished || !FINISHED.includes(idea.status);
  const raw = all.filter((idea) => !idea.processed && visible(idea));
  const done = all.filter((idea) => idea.processed && visible(idea));
  const hidden = all.filter((idea) => !visible(idea)).length;
  const first = all[0]?.id;
  const last = all[all.length - 1]?.id;

  const list = (items: VideoIdea[]) => items.map((idea) => (
    <IdeaCard key={idea.id} idea={idea} busy={busy} send={send} first={first === idea.id} last={last === idea.id} />
  ));

  return (
    <div className="content wide">
      <div className="page-head">
        <h1>Video Ideas</h1>
        <button type="button" className="small" disabled={busy} onClick={() => void load()}>Reload</button>
      </div>
      <p className="muted">Videos you might make. Put the one you'd make next at the top. Saved in Video Projects\Video Ideas.json.</p>
      {error && <p className="error">{error}</p>}

      <form className="idea-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input type="text" value={title} maxLength={300} placeholder="A new video idea" onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" disabled={busy || !title.trim()}>Add Idea</button>
      </form>

      {ideas && !ideas.length && <p className="muted">No ideas yet. Type one above.</p>}

      {ideas && (
        <details className="page-section" open>
          <summary>Raw <span className="muted">({raw.length}) · raw brain dumps still to sort out</span></summary>
          {raw.length ? list(raw) : <p className="muted">Nothing left to process.</p>}
        </details>
      )}

      {ideas && (
        <details className="page-section">
          <summary>Processed <span className="muted">({done.length}) · turned into clear ideas</span></summary>
          {done.length ? list(done) : <p className="muted">No processed ideas yet.</p>}
        </details>
      )}

      {(hidden > 0 || showFinished) && (
        <label className="small-label">
          <input type="checkbox" checked={showFinished} onChange={(e) => setShowFinished(e.target.checked)} />
          Show Made and Dropped Ideas{hidden > 0 ? ` (${hidden})` : ''}
        </label>
      )}
    </div>
  );
}

function IdeaCard({ idea, busy, send, first, last }: {
  idea: VideoIdea; busy: boolean; first: boolean; last: boolean;
  send: (url: string, data: unknown) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(idea.title);
  const [notes, setNotes] = useState(idea.notes);
  // After a save the server's copy is the new starting point.
  useEffect(() => { setTitle(idea.title); setNotes(idea.notes); }, [idea.title, idea.notes]);
  const changed = title !== idea.title || notes !== idea.notes;

  const remove = () => {
    if (!window.confirm(`Delete the idea “${idea.title}”? This cannot be undone.`)) return;
    void send('/api/ideas/delete', { id: idea.id });
  };

  return (
    <details className={`card idea-card${FINISHED.includes(idea.status) ? ' finished' : ''}`}>
      <summary>
        <span className="idea-title">{idea.title}</span>
        <span className="muted small-text">{FORMAT_LABELS[idea.format]} · {STATUS_LABELS[idea.status]}{idea.notes.trim() ? ' · Has Notes' : ''}{idea.references.length ? ` · ${idea.references.length} Link${idea.references.length === 1 ? '' : 's'}` : ''}</span>
      </summary>
      <div className="idea-body">
        <input className="idea-title-input" type="text" value={title} maxLength={300} aria-label="Title" onChange={(e) => setTitle(e.target.value)} />
        <div className="idea-fields">
          <select aria-label="Status" value={idea.status} disabled={busy} onChange={(e) => void send('/api/ideas/update', { id: idea.id, status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Format" value={idea.format} disabled={busy} onChange={(e) => void send('/api/ideas/update', { id: idea.id, format: e.target.value })}>
            {Object.entries(FORMAT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <textarea rows={3} aria-label="Notes" value={notes} maxLength={20000} placeholder="Why this video, who it's for, what you'd say…" onChange={(e) => setNotes(e.target.value)} />
        <div className="idea-refs">
          <div className="idea-refs-head">References</div>
          {idea.references.map((ref, at) => (
            <ReferenceRow key={ref.id} ideaId={idea.id} reference={ref} busy={busy} send={send}
              first={at === 0} last={at === idea.references.length - 1} />
          ))}
          <AddReference ideaId={idea.id} busy={busy} send={send} />
        </div>
        <div className="idea-actions">
          <button type="button" className="small" disabled={busy || !changed || !title.trim()} onClick={() => void send('/api/ideas/update', { id: idea.id, title, notes })}>Save</button>
          {changed && <button type="button" className="small" onClick={() => { setTitle(idea.title); setNotes(idea.notes); }}>Undo</button>}
          <button type="button" className="small" disabled={busy || changed} title={changed ? 'Save first' : undefined} onClick={() => void send('/api/ideas/update', { id: idea.id, processed: !idea.processed })}>
            {idea.processed ? 'Back to Raw' : 'Mark Processed'}
          </button>
          <span className="muted small-text">Changed {new Date(idea.updatedAt).toLocaleDateString()}</span>
          <span className="spacer" />
          <button type="button" className="small" disabled={busy || first || changed} title={changed ? 'Save first' : undefined} onClick={() => void send('/api/ideas/move', { id: idea.id, step: -1 })}>Up</button>
          <button type="button" className="small" disabled={busy || last || changed} title={changed ? 'Save first' : undefined} onClick={() => void send('/api/ideas/move', { id: idea.id, step: 1 })}>Down</button>
          <button type="button" className="small danger-outline" disabled={busy} onClick={remove}>Delete</button>
        </div>
      </div>
    </details>
  );
}

/** One link: its web address and a note, with Save, Up, Down and Delete. */
function ReferenceRow({ ideaId, reference, busy, send, first, last }: {
  ideaId: string; reference: IdeaReference; busy: boolean; first: boolean; last: boolean;
  send: (url: string, data: unknown) => Promise<boolean>;
}) {
  const [url, setUrl] = useState(reference.url);
  const [note, setNote] = useState(reference.note);
  useEffect(() => { setUrl(reference.url); setNote(reference.note); }, [reference.url, reference.note]);
  const changed = url !== reference.url || note !== reference.note;
  const base = { id: ideaId, referenceId: reference.id };

  const remove = () => {
    if (!window.confirm(`Delete the link ${reference.url}?`)) return;
    void send('/api/ideas/reference/delete', base);
  };

  return (
    <div className="idea-ref">
      <input type="url" aria-label="Link address" placeholder="https://…" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} />
      <input type="text" aria-label="Link note" placeholder="Note" maxLength={20000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="idea-ref-actions">
        <button type="button" className="small" disabled={busy || !changed || !url.trim()} onClick={() => void send('/api/ideas/reference/update', { ...base, url, note })}>Save</button>
        <button type="button" className="small" disabled={busy || first || changed} title={changed ? 'Save first' : undefined} onClick={() => void send('/api/ideas/reference/move', { ...base, step: -1 })}>Up</button>
        <button type="button" className="small" disabled={busy || last || changed} title={changed ? 'Save first' : undefined} onClick={() => void send('/api/ideas/reference/move', { ...base, step: 1 })}>Down</button>
        <button type="button" className="small danger-outline" disabled={busy} onClick={remove}>Delete</button>
      </div>
    </div>
  );
}

/** A new link at the bottom of the list. */
function AddReference({ ideaId, busy, send }: {
  ideaId: string; busy: boolean; send: (url: string, data: unknown) => Promise<boolean>;
}) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const add = async () => {
    if (await send('/api/ideas/reference/add', { id: ideaId, url, note })) { setUrl(''); setNote(''); }
  };
  return (
    <div className="idea-ref idea-ref-new">
      <input type="url" aria-label="New link address" placeholder="https://…" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} />
      <input type="text" aria-label="New link note" placeholder="Note" maxLength={20000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="idea-ref-actions">
        <button type="button" className="small" disabled={busy || !url.trim()} onClick={() => void add()}>Add Link</button>
      </div>
    </div>
  );
}
