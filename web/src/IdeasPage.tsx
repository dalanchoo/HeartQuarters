import { useEffect, useRef, useState } from 'react';
import { formatSize, getJson, postJson, type AiId } from './api';
import { useAutosavedText } from './unsavedEdits';
import { useAi } from './AiPicker';
import { channelRows, rowName, videoProjectsHash } from './channelRows';
import { ALL_VIDEO_FILTERS, VideoFilterBar, type VideoSearchFilters } from './VideoFinder';
import type { ChannelVideo, ChannelVideoList } from '../../server/channel-videos';
import type { BrainstormMessage, IdeaBrainstorm } from '../../server/idea-brainstorm';
import type { IdeaAttachment, IdeaCategory, IdeaFormat, IdeaReference, IdeaStatus, VideoIdea } from '../../server/video-ideas';

/** A filter dropdown value: "all" shows everything. */
type Filter<T extends string> = 'all' | T;

// The Ideas tab: John's own list of videos he might make, kept in Video Projects\Video Ideas.json.
// Status runs Raw (a brain dump), Processed (a clear idea), then Brainstorming and on toward Made.
// The order is his: the top is what he'd make next.
export const STATUS_LABELS: Record<IdeaStatus, string> = {
  raw: 'Raw',
  processed: 'Processed',
  brainstorming: 'Brainstorming',
  researching: 'Researching',
  packaged: 'Packaged',
  filming: 'Filming',
  made: 'Made',
  dropped: 'Dropped',
};
const FINISHED: IdeaStatus[] = ['made', 'dropped'];
export const CATEGORY_LABELS: Record<IdeaCategory, string> = { unassigned: 'Unassigned', sdam: 'SDAM', aphantasia: 'Aphantasia', psychedelics: 'Psychedelics', emotions: 'Emotions', relationships: 'Relationships', kink: 'Kink', healing: 'Healing', meaning: 'Meaning', wisdom: 'Wisdom', story: 'My Story' };
export const FORMAT_LABELS: Record<IdeaFormat, string> = { undecided: 'Undecided', longform: 'Longform', short: 'Short' };

/**
 * The grey details after an idea's title. Values nobody has chosen yet (Unassigned, Undecided,
 * Raw) are left out: on almost every row they only add noise.
 */
export function ideaLabels(idea: Pick<VideoIdea, 'category' | 'format' | 'status' | 'notes' | 'references' | 'attachments'>): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return [
    idea.category !== 'unassigned' && CATEGORY_LABELS[idea.category],
    idea.format !== 'undecided' && FORMAT_LABELS[idea.format],
    idea.status !== 'raw' && STATUS_LABELS[idea.status],
    idea.notes.trim() && 'Has Notes',
    idea.references.length > 0 && plural(idea.references.length, 'Link'),
    idea.attachments.length > 0 && plural(idea.attachments.length, 'File'),
  ].filter(Boolean).join(' · ');
}

export function IdeasPage() {
  const [ideas, setIdeas] = useState<VideoIdea[] | null>(null);
  const [videos, setVideos] = useState<ChannelVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [showFinished, setShowFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<Filter<IdeaCategory>>('all');
  const [format, setFormat] = useState<Filter<IdeaFormat>>('all');
  const [status, setStatus] = useState<Filter<IdeaStatus>>('all');
  const [text, setText] = useState('');
  const [brainstormId, setBrainstormId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('hq-brainstorm-width'));
      return Number.isFinite(saved) && saved >= 300 ? saved : 440;
    } catch {
      return 440;
    }
  });

  const load = () => getJson<VideoIdea[]>('/api/ideas').then(setIdeas, (e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    void getJson<ChannelVideoList | null>('/api/channel/videos').then((data) => {
      setVideos((data?.videos ?? []).filter((v) => !!v.piece));
    }, () => {});
  }, []);

  /** Send one change; the server replies with the whole updated list. */
  const send = async (url: string, data: unknown) => {
    setBusy(true); setError(null);
    try { setIdeas(await postJson<VideoIdea[]>(url, data)); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };

  const uploadAttachment = async (ideaId: string, file: File, note: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(
        `/api/ideas/attachment/upload?id=${encodeURIComponent(ideaId)}&name=${encodeURIComponent(file.name)}&note=${encodeURIComponent(note)}`,
        { method: 'POST', headers: { 'X-HeartQuarters': '1', 'Content-Type': 'application/octet-stream' }, body: file },
      );
      const body = (await res.json().catch(() => ({}))) as VideoIdea[] & { error?: string };
      if (!res.ok) throw new Error(body.error || res.statusText || 'Could not attach file.');
      setIdeas(body);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!title.trim()) return;
    if (await send('/api/ideas/add', { title })) setTitle('');
  };

  const all = ideas ?? [];
  const activeIdea = brainstormId ? all.find((i) => i.id === brainstormId) ?? null : null;
  const matches = (idea: VideoIdea) =>
    (category === 'all' || idea.category === category)
    && (format === 'all' || idea.format === format)
    && (status === 'all' || idea.status === status)
    && (!text.trim() || `${idea.title} ${idea.notes}`.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase()));
  const filtering = category !== 'all' || format !== 'all' || status !== 'all' || text.trim() !== '';
  const visible = (idea: VideoIdea) => matches(idea) && (showFinished || filtering || !FINISHED.includes(idea.status));
  // Up Next ideas show only in their own short list at the top, not again in Raw or Processed.
  const upNext = all.filter((idea) => idea.upNext && visible(idea));
  const others = all.filter((idea) => !idea.upNext && visible(idea));
  const hidden = all.filter((idea) => matches(idea) && !visible(idea)).length;

  const list = (items: VideoIdea[]) => items.map((idea, index) => (
    <IdeaCard
      key={idea.id}
      idea={idea}
      videos={videos}
      busy={busy}
      send={send}
      uploadAttachment={uploadAttachment}
      prevId={items[index - 1]?.id}
      nextId={items[index + 1]?.id}
      brainstorming={activeIdea?.id === idea.id}
      onBrainstorm={() => setBrainstormId((cur) => (cur === idea.id ? null : idea.id))}
    />
  ));

  const mainContent = (
    <div className={activeIdea ? 'ideas-main' : 'content wide'}>
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

      {ideas && (
        <div className="idea-filters">
          <label>Category
            <select value={category} onChange={(e) => setCategory(e.target.value as Filter<IdeaCategory>)}>
              <option value="all">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>Format
            <select value={format} onChange={(e) => setFormat(e.target.value as Filter<IdeaFormat>)}>
              <option value="all">All Formats</option>
              {Object.entries(FORMAT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as Filter<IdeaStatus>)}>
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="idea-filter-text">Filter
            <input type="text" value={text} placeholder="Words in the title or notes" onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
      )}

      {ideas && !ideas.length && <p className="muted">No ideas yet. Type one above.</p>}

      {ideas && (
        <details className="page-section idea-section" open>
          <summary>Active <span className="muted">({upNext.length}) · the few you're working on now</span></summary>
          {upNext.length ? list(upNext) : <p className="muted">Open an idea and click Add to Active to keep it here.</p>}
        </details>
      )}

      {ideas && (
        <details className="page-section idea-section">
          <summary>Backlog <span className="muted">({others.length}) · use the Status filter for Raw or Processed</span></summary>
          {others.length ? list(others) : <p className="muted">No other ideas match.</p>}
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

  if (!activeIdea) return mainContent;

  return (
    <div className="ideas-split">
      {mainContent}
      <BrainstormResizer width={panelWidth} onWidth={(w, save) => {
        setPanelWidth(w);
        if (save) { try { localStorage.setItem('hq-brainstorm-width', String(w)); } catch { /* convenience */ } }
      }} />
      <BrainstormPanel
        idea={activeIdea}
        width={panelWidth}
        busyIdeas={busy}
        onAddToNotes={async (textToAdd) => {
          const next = activeIdea.notes.trim() ? `${activeIdea.notes.trim()}\n\n${textToAdd}` : textToAdd;
          return send('/api/ideas/update', { id: activeIdea.id, notes: next });
        }}
        onClose={() => setBrainstormId(null)}
      />
    </div>
  );
}

function IdeaCard({ idea, videos, busy, send, uploadAttachment, prevId, nextId, brainstorming, onBrainstorm }: {
  idea: VideoIdea; videos: ChannelVideo[]; busy: boolean; prevId?: string; nextId?: string; brainstorming: boolean;
  send: (url: string, data: unknown) => Promise<boolean>;
  uploadAttachment: (ideaId: string, file: File, note: string) => Promise<boolean>;
  onBrainstorm: () => void;
}) {
  // Title and notes save themselves a moment after typing stops, like the dropdowns.
  const title = useAutosavedText(idea.title, (value) => send('/api/ideas/update', { id: idea.id, title: value }), (value) => !!value.trim());
  const notes = useAutosavedText(idea.notes, (value) => send('/api/ideas/update', { id: idea.id, notes: value }));

  const remove = () => {
    if (!window.confirm(`Delete the idea “${idea.title}”? This cannot be undone.`)) return;
    void send('/api/ideas/delete', { id: idea.id });
  };

  return (
    <details className={`card idea-card${FINISHED.includes(idea.status) ? ' finished' : ''}`}>
      <summary>
        <span className="idea-title">{idea.title}</span>
        <span className="muted small-text">{ideaLabels(idea)}</span>
      </summary>
      <div className="idea-body">
        <input className={`idea-title-input${title.dirty ? ' unsaved' : ''}`} type="text" value={title.value} maxLength={300} aria-label="Title" onChange={(e) => title.setValue(e.target.value)} onBlur={title.flush} />
        <div className="idea-fields">
          <select aria-label="Status" value={idea.status} disabled={busy} onChange={(e) => void send('/api/ideas/update', { id: idea.id, status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Category" value={idea.category} disabled={busy} onChange={(e) => void send('/api/ideas/update', { id: idea.id, category: e.target.value })}>
            {Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select aria-label="Format" value={idea.format} disabled={busy} onChange={(e) => void send('/api/ideas/update', { id: idea.id, format: e.target.value })}>
            {Object.entries(FORMAT_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <span className="spacer" />
          <button type="button" className="small" disabled={busy} onClick={() => void send('/api/ideas/update', { id: idea.id, upNext: !idea.upNext })}>
            {idea.upNext ? 'Remove From Active' : 'Add to Active'}
          </button>
          <button type="button" className="small danger-outline" disabled={busy} onClick={remove}>Delete</button>
          <button type="button" className="small idea-move-btn" aria-label="Move up" title="Move up" disabled={busy || !prevId} onClick={() => void send('/api/ideas/move', { id: idea.id, step: -1, targetId: prevId })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
          <button type="button" className="small idea-move-btn" aria-label="Move down" title="Move down" disabled={busy || !nextId} onClick={() => void send('/api/ideas/move', { id: idea.id, step: 1, targetId: nextId })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12l7 7 7-7" />
            </svg>
          </button>
        </div>
        <textarea className={notes.dirty ? 'unsaved' : undefined} rows={3} aria-label="Notes" value={notes.value} maxLength={20000} placeholder="Why this video, who it's for, what you'd say…" onChange={(e) => notes.setValue(e.target.value)} onBlur={notes.flush} />
        {/* The finder sits on the left at its own width; links, files and the idea's buttons fill the rest. */}
        <div className="idea-lower">
        <VideoFinder ideaId={idea.id} videos={videos} busy={busy} send={send} />
        <div className="idea-lower-main">
        <div className="idea-refs">
          <div className="idea-refs-head">Links and Files</div>
          <IdeaLinkList idea={idea} busy={busy} send={send} />
          <AddLink ideaId={idea.id} busy={busy} send={send} />
        </div>
        <AttachmentsSection idea={idea} busy={busy} send={send} uploadAttachment={uploadAttachment} />
        <div className="idea-actions">
          <button type="button" className={`small${brainstorming ? ' active-brainstorm' : ''}`} onClick={onBrainstorm}>
            {brainstorming ? 'Close Brainstorm' : 'Brainstorm'}
          </button>
          <span className="muted small-text">{title.dirty || notes.dirty ? 'Saving…' : `Saved · Changed ${new Date(idea.updatedAt).toLocaleDateString()}`}</span>
        </div>
        </div>
        </div>
      </div>
    </details>
  );
}

/** How a link reads in the list: its note, or else the address (a HeartQuarters video link without its code). */
export function linkLabel(reference: Pick<IdeaReference, 'url' | 'note'>): string {
  if (reference.note.trim()) return reference.note.trim();
  if (reference.url.startsWith('#Videos/')) {
    try { return decodeURIComponent(reference.url.slice('#Videos/'.length).split('/').pop() ?? reference.url); } catch { return reference.url; }
  }
  return reference.url;
}

/** The web site a link goes to, shown in grey after a link that has a note. */
function linkSite(url: string): string {
  if (url.startsWith('#Videos/')) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** The idea's links, then its files below a divider: each one clickable, with a small × to remove it. */
function IdeaLinkList({ idea, busy, send }: {
  idea: VideoIdea; busy: boolean; send: (url: string, data: unknown) => Promise<boolean>;
}) {
  if (!idea.references.length && !idea.attachments.length) return <p className="muted small-text">No links or files yet.</p>;
  const removeLink = (ref: IdeaReference) => {
    if (!window.confirm(`Remove the link “${linkLabel(ref)}”?`)) return;
    void send('/api/ideas/reference/delete', { id: idea.id, referenceId: ref.id });
  };
  const removeFile = (att: IdeaAttachment) => {
    if (!window.confirm(`Remove “${att.name}”? It will be moved to HeartQuarters Trash.`)) return;
    void send('/api/ideas/attachment/delete', { id: idea.id, attachmentId: att.id });
  };
  return (
    <ul className="idea-link-list">
      {idea.references.map((ref) => {
        const internal = ref.url.startsWith('#Videos/');
        const site = ref.note.trim() ? linkSite(ref.url) : '';
        return (
          <li key={ref.id}>
            <a href={ref.url} title={ref.url} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noreferrer'}>{linkLabel(ref)}</a>
            {site && <span className="muted small-text">{site}</span>}
            <button type="button" className="remove-x" disabled={busy} aria-label={`Remove ${linkLabel(ref)}`} title="Remove" onClick={() => removeLink(ref)}>×</button>
          </li>
        );
      })}
      {idea.references.length > 0 && idea.attachments.length > 0 && <li className="idea-link-divider" aria-hidden="true" />}
      {idea.attachments.map((att) => (
        <li key={att.id}>
          <a href={`/api/ideas/attachment?id=${encodeURIComponent(idea.id)}&attachmentId=${encodeURIComponent(att.id)}`} target="_blank" rel="noreferrer">{att.name}</a>
          <span className="muted small-text">{[att.note.trim(), formatSize(att.size)].filter(Boolean).join(' · ')}</span>
          <button type="button" className="remove-x" disabled={busy} aria-label={`Remove ${att.name}`} title="Remove" onClick={() => removeFile(att)}>×</button>
        </li>
      ))}
    </ul>
  );
}

/** A box for pasting a web address; Enter or Add Link adds it to the end of the list. */
function AddLink({ ideaId, busy, send }: {
  ideaId: string; busy: boolean; send: (url: string, data: unknown) => Promise<boolean>;
}) {
  const [url, setUrl] = useState('');
  const add = async () => {
    if (url.trim() && await send('/api/ideas/reference/add', { id: ideaId, url: url.trim(), note: '' })) setUrl('');
  };
  return (
    <form className="idea-add-link" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <input type="text" aria-label="New link address" placeholder="Paste a link (https://…)" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} />
      <button type="submit" className="small" disabled={busy || !url.trim()}>Add Link</button>
    </form>
  );
}

/** A collapsible Video Finder matching Channel → Video Detail: click a video to choose it, then Add Video. */
function VideoFinder({ ideaId, videos, busy, send }: {
  ideaId: string; videos: ChannelVideo[]; busy: boolean; send: (url: string, data: unknown) => Promise<boolean>;
}) {
  const [filters, setFilters] = useState<VideoSearchFilters>(ALL_VIDEO_FILTERS);
  const [chosen, setChosen] = useState<string | null>(null);
  const matching = channelRows(videos, filters, 'publishedAt', true);
  const filtering = filters.kind !== 'all' || filters.topic !== 'all' || filters.angle !== 'all' || !!filters.text;
  const picked = videos.find((v) => v.id === chosen) ?? null;
  // John can drag the finder's right edge; the width is remembered in this browser (a convenience only).
  const finderRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = finderRef.current;
    if (!el) return;
    try { const saved = Number(localStorage.getItem('hq-idea-finder-width')); if (saved >= 200) el.style.width = `${saved}px`; } catch { /* convenience */ }
    const watch = new ResizeObserver(() => {
      if (!el.style.width) return;
      try { localStorage.setItem('hq-idea-finder-width', String(Math.round(el.offsetWidth))); } catch { /* convenience */ }
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [videos.length]);

  const add = async () => {
    if (!picked) return;
    const done = await send('/api/ideas/reference/add', { id: ideaId, url: videoProjectsHash(picked.piece ?? ''), note: rowName(picked) });
    if (done) setChosen(null);
  };

  if (!videos.length) return null;
  return (
    <section className="idea-video-finder" ref={finderRef}>
      <div className="idea-refs-head">Find a Video in HeartQuarters</div>
      <div className="idea-video-finder-body">
        <VideoFilterBar
          filters={filters}
          onChange={setFilters}
          searchAction={<button type="button" className="small" disabled={busy || !picked} title={picked ? `Add ${rowName(picked)}` : 'Click a video below first'} onClick={() => void add()}>Add Video</button>}
        />
        <p className="muted small-text idea-video-count">
          {matching.length} {filtering ? 'Matching ' : ''}{matching.length === 1 ? 'Video' : 'Videos'} · click one, then Add Video
        </p>
        <div className="idea-video-list">
          {matching.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`idea-video-option${v.id === chosen ? ' chosen' : ''}`}
              aria-pressed={v.id === chosen}
              title={v.title}
              onClick={() => setChosen((cur) => (cur === v.id ? null : v.id))}
              onDoubleClick={() => void add()}
            >
              {rowName(v)}
            </button>
          ))}
          {matching.length === 0 && <p className="muted small-text">No videos match these filters.</p>}
        </div>
      </div>
    </section>
  );
}

/** Files attached to an idea (such as PDFs), saved in Video Projects\_IdeaResources\<ideaId>\. */
function AttachmentsSection({ idea, busy, send, uploadAttachment }: {
  idea: VideoIdea;
  busy: boolean;
  send: (url: string, data: unknown) => Promise<boolean>;
  uploadAttachment: (ideaId: string, file: File, note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  const attachFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    let allOk = true;
    for (const file of files) {
      const ok = await uploadAttachment(idea.id, file, note);
      if (!ok) {
        allOk = false;
        break;
      }
    }
    if (allOk) setNote('');
  };

  const filesFromClipboard = (data: DataTransfer | null): File[] => {
    if (!data) return [];
    if (data.files?.length) return Array.from(data.files);
    return Array.from(data.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
  };

  return (
    <div className="idea-refs">
      <div
        className={`idea-attach-drop${dragging ? ' dragging' : ''}`}
        tabIndex={0}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) void attachFiles(files);
        }}
        onPaste={(e) => {
          const files = filesFromClipboard(e.clipboardData);
          if (!files.length) return;
          e.preventDefault();
          void attachFiles(files);
        }}
      >
        <div className="idea-attach-new">
          <input
            type="text"
            aria-label="New attachment note"
            placeholder="Optional note for the file (e.g. SDAM PDF)"
            maxLength={20000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void attachFiles(files);
            }}
          />
          <button type="button" className="small" disabled={busy} onClick={() => pickerRef.current?.click()}>
            Attach File
          </button>
        </div>
        <div className="muted small-text idea-attach-hint">
          {dragging ? 'Drop to attach…' : 'Drop files here, or click here and press Ctrl+V to paste a file or image.'}
        </div>
      </div>
    </div>
  );
}

const BRAINSTORM_AIS: { id: AiId; label: string }[] = [
  { id: 'claude', label: 'Send to Claude' },
  { id: 'codex', label: 'Send to ChatGPT' },
  { id: 'gemini', label: 'Send to Gemini' },
];

const SPEAKER_NAMES: Record<BrainstormMessage['from'], string> = {
  john: 'John',
  claude: 'Claude',
  codex: 'ChatGPT',
  gemini: 'Gemini',
};

function clampBrainstormWidth(width: number): number {
  const max = Math.min(820, Math.max(300, window.innerWidth - 360));
  return Math.round(Math.min(max, Math.max(300, width)));
}

function BrainstormResizer({ width, onWidth }: { width: number; onWidth: (width: number, save: boolean) => void }) {
  const drag = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const latest = useRef(width);
  latest.current = width;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const active = drag.current;
      if (active?.pointerId === e.pointerId) {
        onWidth(clampBrainstormWidth(active.width + (active.x - e.clientX)), false);
      }
    };
    const stop = (e: PointerEvent) => {
      if (drag.current?.pointerId !== e.pointerId) return;
      drag.current = null;
      document.body.classList.remove('is-resizing-sidebar');
      if (e.type === 'pointerup') onWidth(latest.current, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (drag.current) document.body.classList.remove('is-resizing-sidebar');
    };
  }, [onWidth]);

  return (
    <div
      className="sidebar-resizer brainstorm-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Brainstorm Panel"
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, width: latest.current, pointerId: e.pointerId };
        document.body.classList.add('is-resizing-sidebar');
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); onWidth(clampBrainstormWidth(latest.current + 24), true); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onWidth(clampBrainstormWidth(latest.current - 24), true); }
      }}
      onDoubleClick={() => onWidth(440, true)}
    />
  );
}

function BrainstormPanel({ idea, width, busyIdeas, onAddToNotes, onClose }: {
  idea: VideoIdea;
  width: number;
  busyIdeas: boolean;
  onAddToNotes: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<IdeaBrainstorm | null>(null);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState<AiId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const { overview } = useAi();
  const listRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = (snippet: string) => {
    const el = draftRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const before = draft.slice(0, start);
    const after = draft.slice(end);
    const padLeft = before && !/[\s\n]$/.test(before) ? ' ' : '';
    const padRight = after && !/^[\s\n]/.test(after) ? ' ' : '';
    const next = `${before}${padLeft}${snippet}${padRight}${after}`;
    const caret = before.length + padLeft.length + snippet.length;
    setDraft(next);
    requestAnimationFrame(() => {
      if (!draftRef.current) return;
      draftRef.current.focus();
      draftRef.current.setSelectionRange(caret, caret);
    });
  };

  useEffect(() => {
    let active = true;
    setError(null);
    setThread(null);
    getJson<IdeaBrainstorm>(`/api/ideas/brainstorm?id=${encodeURIComponent(idea.id)}`).then(
      (data) => { if (active) setThread(data); },
      (e: Error) => { if (active) setError(e.message); },
    );
    return () => { active = false; };
  }, [idea.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);

  const sendTo = async (ai: AiId) => {
    const msg = draft.trim();
    if (!msg || asking) return;
    setAsking(ai);
    setError(null);
    try {
      const updated = await postJson<IdeaBrainstorm>('/api/ideas/brainstorm/send', { id: idea.id, ai, message: msg });
      setThread(updated);
      setDraft('');
    } catch (e) {
      setError((e as Error).message);
      // Reload in case John's message was saved before the AI call failed.
      void getJson<IdeaBrainstorm>(`/api/ideas/brainstorm?id=${encodeURIComponent(idea.id)}`).then(setThread, () => {});
    } finally {
      setAsking(null);
    }
  };

  const clear = async () => {
    if (!thread?.messages.length) return;
    if (!window.confirm(`Clear the brainstorm conversation for “${idea.title}”?`)) return;
    setError(null);
    try {
      setThread(await postJson<IdeaBrainstorm>('/api/ideas/brainstorm/clear', { id: idea.id }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const messages = thread?.messages ?? [];

  return (
    <aside className="ideas-brainstorm" style={{ width: `${width}px` }}>
      <div className="brainstorm-head">
        <div>
          <h2>Brainstorm</h2>
          <div className="muted small-text brainstorm-idea-title">{idea.title}</div>
        </div>
        <div className="brainstorm-head-actions">
          <button type="button" className="small" disabled={!!asking || !messages.length} onClick={() => void clear()}>Clear</button>
          <button type="button" className="small" onClick={onClose}>Close</button>
        </div>
      </div>

      <p className="muted small-text brainstorm-context-note">
        Saved in Drive. Each AI sees the idea title, notes, references, and full thread.
      </p>

      {error && <p className="error">{error}</p>}

      <div className="brainstorm-messages" ref={listRef}>
        {thread === null && !error && <p className="muted small-text">Loading conversation…</p>}
        {thread !== null && messages.length === 0 && (
          <p className="muted small-text">
            No messages yet. Type a thought below and send it to Claude, ChatGPT, or Gemini.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`brainstorm-msg brainstorm-msg--${m.from}`}>
            <div className="brainstorm-msg-head">
              <strong>{SPEAKER_NAMES[m.from]}</strong>
              <span className="muted small-text">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              {m.from !== 'john' && (
                <button
                  type="button"
                  className="small brainstorm-add-note"
                  disabled={busyIdeas}
                  onClick={() => {
                    void onAddToNotes(m.text).then((ok) => {
                      if (ok) {
                        setAddedId(m.id);
                        setTimeout(() => setAddedId((cur) => (cur === m.id ? null : cur)), 1500);
                      }
                    });
                  }}
                >
                  {addedId === m.id ? 'Added' : 'Add to Notes'}
                </button>
              )}
            </div>
            <div className="brainstorm-msg-text">{m.text}</div>
          </div>
        ))}
      </div>

      {asking && <p className="muted small-text">Asking {SPEAKER_NAMES[asking]}…</p>}

      <div className="brainstorm-compose">
        {(idea.attachments.length > 0 || idea.references.length > 0) && (
          <div className="brainstorm-inserts">
            {idea.attachments.length > 0 && (
              <select
                aria-label="Insert Attached File"
                value=""
                disabled={!!asking}
                onChange={(e) => {
                  const att = idea.attachments.find((a) => a.id === e.target.value);
                  if (!att) return;
                  insertAtCursor(`[Attached File: ${att.name}]`);
                }}
              >
                <option value="">Insert File…</option>
                {idea.attachments.map((att) => (
                  <option key={att.id} value={att.id}>
                    {att.name}{att.note ? ` — ${att.note}` : ''}
                  </option>
                ))}
              </select>
            )}
            {idea.references.length > 0 && (
              <select
                aria-label="Insert Reference Link"
                value=""
                disabled={!!asking}
                onChange={(e) => {
                  const ref = idea.references.find((r) => r.id === e.target.value);
                  if (!ref) return;
                  insertAtCursor(ref.note ? `${ref.url} (${ref.note})` : ref.url);
                }}
              >
                <option value="">Insert Link…</option>
                {idea.references.map((ref) => (
                  <option key={ref.id} value={ref.id}>
                    {ref.note || ref.url}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <textarea
          ref={draftRef}
          rows={3}
          value={draft}
          disabled={!!asking}
          maxLength={20000}
          placeholder="Ask for angles, hooks, structure, or a devil's advocate…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="brainstorm-send-buttons">
          {BRAINSTORM_AIS.map(({ id, label }) => {
            const opt = overview?.options.find((o) => o.id === id);
            const available = opt ? opt.available : true;
            return (
              <button
                key={id}
                type="button"
                className="small"
                disabled={!!asking || !draft.trim() || !available}
                title={!available ? `${SPEAKER_NAMES[id]} is not installed` : undefined}
                onClick={() => void sendTo(id)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
