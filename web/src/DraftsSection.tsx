import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fileUrl, getJson, getText, openInExplorer, postJson, thumbUrl, type BriefChoice, type BriefJob, type BriefPick, type BriefSource, type DraftConversation, type Drafts, type ExpressionIndex } from './api';
import { categoriesIn, photosIn } from './expressionPick';

// The card's "Thumbnail & Title Drafts" section: the brainstorming in Packaging\Drafts before a version is made.
// At the top, Write Brief: Claude writes Brief.md, ChatGPT and Gemini review it, and Claude picks the top 3 title and
// thumbnail pairs (server/brief.ts). The top 3 show as cards to choose from; the full brief opens below them, then one
// box per AI conversation with every image it made, newest first, and what was asked.
export function DraftsSection({ piece, drafts, onChanged }: { piece: string; drafts: Drafts | null; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const images = drafts?.conversations.reduce((n, c) => n + c.images.length, 0) ?? 0;
  const conversations = drafts?.conversations.length ?? 0;
  return (
    <details className="drafts" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Thumbnail & Title Drafts{' '}
        <span className="muted small-text">
          ·{' '}
          {drafts
            ? `${drafts.brief ? 'brief, ' : ''}${conversations} ${conversations === 1 ? 'conversation' : 'conversations'}, ${images} ${images === 1 ? 'image' : 'images'}`
            : 'none yet'}
        </span>
      </summary>
      {open && <WriteBrief piece={piece} hasBrief={!!drafts?.brief} hasPicks={!!drafts?.picks} onChanged={onChanged} />}
      {drafts?.picks && <TopPicks piece={piece} picks={drafts.picks} choice={drafts.choice} onChanged={onChanged} />}
      {drafts && (
        <>
          <div className="drafts-top">
            <button className="small" onClick={() => openInExplorer('projects', drafts.path)}>
              Open Drafts Folder
            </button>
            {drafts.brief && <TextToggle key={drafts.brief.path + drafts.brief.size} label="Full Brief" path={drafts.brief.path} />}
          </div>
          <div className="drafts-grid">
            {drafts.conversations.map((c) => (
              <Conversation key={c.path} conversation={c} />
            ))}
          </div>
        </>
      )}
    </details>
  );
}

/** The top 3 title and thumbnail pairs, as cards. Choose saves one (Choice.json); then its photos appear to pick from. */
function TopPicks({ piece, picks, choice, onChanged }: { piece: string; picks: BriefPick[]; choice: BriefChoice | null; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The saved choice counts only while it's still one of these picks (a new brief brings new picks).
  const chosen = choice && picks[choice.index]?.title === choice.pick.title ? choice.index : null;
  const choose = (index: number) => {
    setBusy(true);
    setError('');
    postJson('/api/brief/choose', { piece, index }).then(() => onChanged?.(), (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <div className="top-picks">
      <h4>Top 3 Title and Thumbnail Pairs</h4>
      <div className="top-picks-grid">
        {picks.map((p, i) => (
          <div key={i} className={`top-pick${chosen === i ? ' chosen' : ''}`}>
            <div className="top-pick-text">
              <ThumbnailWords text={p.thumbnailText} accent={p.accent} />
            </div>
            <p className="top-pick-title">{p.title}</p>
            <p className="small-text"><span className="muted">Expression:</span> {p.expression}</p>
            <p className="small-text"><span className="muted">Background:</span> {p.background}</p>
            <p className="small-text">{p.why}</p>
            {p.backedBy.length > 0 && <p className="muted small-text">Backed by {p.backedBy.join(', ')}</p>}
            <button className="small" disabled={busy || chosen === i} onClick={() => choose(i)}>
              {chosen === i ? 'Chosen' : 'Choose'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {chosen !== null && choice && <PhotoPicker key={chosen} piece={piece} choice={choice} onChanged={onChanged} />}
    </div>
  );
}

/**
 * The chosen pair's photos: every photo in the expressions-library categories it names, grouped by category. Clicking
 * one saves it as the photo for this pair.
 */
function PhotoPicker({ piece, choice, onChanged }: { piece: string; choice: BriefChoice; onChanged?: () => void }) {
  const [library, setLibrary] = useState<ExpressionIndex | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    getJson<ExpressionIndex>('/api/expressions').then(setLibrary, (e: Error) => setError(e.message));
  }, []);
  // The pair's own categories first, then any John adds from the whole library.
  const [added, setAdded] = useState<string[]>([]);
  const categories = [...categoriesIn(choice.pick.expression), ...added.filter((c) => !categoriesIn(choice.pick.expression).includes(c))];
  const pick = (photo: string) => {
    setSaving(photo);
    setError('');
    postJson('/api/brief/photo', { piece, photo }).then(() => onChanged?.(), (e: Error) => setError(e.message)).finally(() => setSaving(null));
  };
  const tile = (p: { path: string; name: string }) => {
    const picked = choice.photo === p.path;
    return (
      <div key={p.path} className={`photo-tile${picked ? ' picked' : ''}`}>
        <button className="photo-choice" disabled={saving !== null} title={`Use ${p.name}`} onClick={() => pick(p.path)}>
          <img src={thumbUrl('expressions', p.path, 320)} alt={p.name} loading="lazy" />
        </button>
        <div className="photo-path">{p.path.replace(/\.[^.]+$/, '')}</div>
        <div className="photo-tile-foot">
          {picked ? <span className="picked-label">✓ Picked</span> : saving === p.path ? <span className="muted">Saving…</span> : null}
          <a href={fileUrl('expressions', p.path)} target="_blank" rel="noreferrer">
            Full Size
          </a>
        </div>
      </div>
    );
  };
  return (
    <div className="photo-picker">
      <h4>Pick the Photo</h4>
      <p className="muted small-text">
        Click a photo to use it for this pair; Full Size opens the whole photo. With your portrait on the left, choose one where you look at the
        camera or to your left (toward the text), not away from it.
      </p>
      {choice.photo && (
        <div className="photo-group">
          <p className="small-text"><strong>Your photo</strong></p>
          <div className="photo-grid">{tile({ path: choice.photo, name: choice.photo.split('/').pop() ?? choice.photo })}</div>
        </div>
      )}
      {!library && !error && <p className="muted small-text">Loading the expressions library…</p>}
      {library && categories.length === 0 && <p className="muted small-text">This pair names no library category. Add one below.</p>}
      {library &&
        categories.map((c) => {
          const photos = photosIn(library.photos, c);
          return (
            <div key={c} className="photo-group">
              <p className="small-text">
                <strong>{c}</strong> <span className="muted">· {photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
                {added.includes(c) && (
                  <button className="small" onClick={() => setAdded(added.filter((a) => a !== c))}>
                    Remove
                  </button>
                )}
              </p>
              {photos.length ? (
                <div className="photo-grid">{photos.map(tile)}</div>
              ) : (
                <p className="muted small-text">No photos in this category yet. Add another category below.</p>
              )}
            </div>
          );
        })}
      {library && (
        <label className="small-text add-category">
          Show photos from another category:{' '}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setAdded([...added.filter((a) => a !== e.target.value), e.target.value]);
            }}
          >
            <option value="">Choose a category…</option>
            {library.categories
              .filter((c) => c.path && !categories.includes(c.path))
              .map((c) => (
                <option key={c.path} value={c.path} disabled={c.totalCount === 0}>
                  {c.path} ({c.totalCount ? `${c.totalCount} ${c.totalCount === 1 ? 'photo' : 'photos'}` : 'no photos yet'})
                </option>
              ))}
          </select>
        </label>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** The thumbnail's words in capitals, with the accent word in the accent colour. */
function ThumbnailWords({ text, accent }: { text: string; accent: string }) {
  const at = accent ? text.toUpperCase().indexOf(accent.toUpperCase()) : -1;
  if (at < 0) return <>{text.toUpperCase()}</>;
  return (
    <>
      {text.slice(0, at).toUpperCase()}
      <span className="accent-word">{text.slice(at, at + accent.length).toUpperCase()}</span>
      {text.slice(at + accent.length).toUpperCase()}
    </>
  );
}

const STATE_WORDS: Record<BriefJob['steps'][number]['state'], string> = {
  waiting: 'waiting',
  working: 'working…',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

/** Write Brief: the source it will use, a box for John's notes or pasted research, the button, and each AI's progress. */
function WriteBrief({ piece, hasBrief, hasPicks, onChanged }: { piece: string; hasBrief: boolean; hasPicks: boolean; onChanged?: () => void }) {
  const [source, setSource] = useState<BriefSource | null | undefined>(undefined);
  const [job, setJob] = useState<BriefJob | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const wasRunning = useRef(false);

  const load = () =>
    getJson<{ source: BriefSource | null; job: BriefJob | null }>(`/api/brief?piece=${encodeURIComponent(piece)}`).then(
      (r) => {
        setSource(r.source);
        setJob(r.job);
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => void load(), [piece]);

  // While the AIs work, check every few seconds. When they finish, the card reloads to show the new brief.
  const running = job?.status === 'running';
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      onChanged?.();
    }
    if (!running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [running]);

  const start = () => {
    if (hasBrief && !window.confirm('Write a new brief? The current Brief.md is kept, renamed with its date and time.')) return;
    setError('');
    postJson<BriefJob>('/api/brief/start', { piece, notes }).then(setJob, (e: Error) => setError(e.message));
  };
  // For a brief written before there were picks, or to pick again: only Claude's last step, about a minute.
  const pick = () => {
    setError('');
    postJson<BriefJob>('/api/brief/picks', { piece, notes }).then(setJob, (e: Error) => setError(e.message));
  };

  if (source === undefined) return error ? <p className="error">{error}</p> : null;
  return (
    <div className="write-brief">
      <p className="muted small-text">
        {source
          ? `Made from the ${source.kind}: ${source.path.split('/').pop()}. Claude writes the brief with vidIQ research (a few vidIQ credits), ChatGPT and Gemini each add a review, and Claude picks the top 3. It takes several minutes.`
          : 'There is no transcript in Subtitles and no script (a file with "script" in its name) to make a brief from yet.'}
      </p>
      {source && !running && (
        <>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional: notes for the AIs (for example what you don't like about the current thumbnail, or which version is on YouTube), or research from Ask Studio or vidIQ" />
          <div className="claude-buttons">
            <button className="small" onClick={start}>
              {hasBrief ? 'Write New Brief' : 'Write Brief'}
            </button>
            {hasBrief && (
              <button className="small" onClick={pick} title="Claude reads the brief and its reviews and picks the top 3 pairs again (about a minute)">
                {hasPicks ? 'Pick Top 3 Again' : 'Pick Top 3'}
              </button>
            )}
          </div>
        </>
      )}
      {job && (
        <ul className="brief-steps">
          {job.steps.map((s, i) => (
            <li key={i} className={`brief-step brief-${s.state}`}>
              {s.name} {s.role === 'writes' ? 'writes the brief' : s.role === 'reviews' ? 'reviews it' : 'picks the top 3'}: {STATE_WORDS[s.state]}
              {s.error && <span className="error"> {s.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {job?.kept && <p className="muted small-text">The earlier brief was kept as {job.kept}.</p>}
      {job?.error && <p className="error">{job.error}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Conversation({ conversation }: { conversation: DraftConversation }) {
  const rounds = [...conversation.images].reverse(); // newest first
  const [shown, setShown] = useState(rounds[0]?.path);
  const current = rounds.find((r) => r.path === shown) ?? rounds[0];
  return (
    <div className="thumb-draft">
      <h4>{conversation.name}</h4>
      {current ? (
        <a href={fileUrl('projects', current.path)} target="_blank" rel="noreferrer" title="Open full size">
          <img src={thumbUrl('projects', current.path, 640)} alt={`${conversation.name}, ${current.name}`} />
        </a>
      ) : (
        <p className="muted small-text">No images yet.</p>
      )}
      {rounds.length > 1 && (
        <div className="draft-rounds">
          {rounds.map((r) => (
            <button key={r.path} className={`small version ${r.path === current?.path ? 'active' : ''}`} onClick={() => setShown(r.path)}>
              {r.name.replace(/\.[^.]+$/, '')}
            </button>
          ))}
        </div>
      )}
      {conversation.requests && <TextToggle label="Requests" path={conversation.requests.path} />}
    </div>
  );
}

/** A button that shows or hides a text file from the drafts, as formatted text (headings, bold, lists). */
function TextToggle({ label, path }: { label: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && text === null) getText('projects', path).then((t) => setText(t.replace(/^﻿/, '')), (e: Error) => setError(e.message));
  }, [open, path, text]);
  return (
    <div className="draft-text">
      <button className="small" onClick={() => setOpen(!open)}>
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open && (error ? <p className="error">{error}</p> : text === null ? <p className="muted small-text">Loading…</p> : <div className="markdown draft-md"><Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown></div>)}
    </div>
  );
}
