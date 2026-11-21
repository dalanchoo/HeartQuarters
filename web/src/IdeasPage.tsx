import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { IdeaFormat, IdeaStatus, VideoIdea } from '../../server/video-ideas';

// The Ideas tab: John's own list of videos he might make, kept in Video Projects\Video Ideas.json.
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
export const FORMAT_LABELS: Record<IdeaFormat, string> = { longform: 'Longform', short: 'Short' };

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

  const shown = (ideas ?? []).filter((idea) => showFinished || !FINISHED.includes(idea.status));
  const hidden = (ideas?.length ?? 0) - shown.length;

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
      {shown.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} busy={busy} send={send}
          first={ideas![0].id === idea.id} last={ideas![ideas!.length - 1].id === idea.id} />
      ))}
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
        <span className="muted small-text">{FORMAT_LABELS[idea.format]} · {STATUS_LABELS[idea.status]}{idea.notes.trim() ? ' · Has Notes' : ''}</span>
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
        <div className="idea-actions">
          <button type="button" className="small" disabled={busy || !changed || !title.trim()} onClick={() => void send('/api/ideas/update', { id: idea.id, title, notes })}>Save</button>
          {changed && <button type="button" className="small" onClick={() => { setTitle(idea.title); setNotes(idea.notes); }}>Undo</button>}
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
