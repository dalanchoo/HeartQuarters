import { useEffect, useState } from 'react';
import { fileUrl, getText, openInExplorer, thumbUrl, type DraftConversation, type Drafts } from './api';

// The card's "Thumbnail & Title Drafts" section: the brainstorming in Packaging\Drafts before a version is made.
// Brief.md (the brief and the AIs' reviews), and one box per AI conversation with every image it made, newest
// first, and what was asked. Only shows what's there for now; the buttons that make drafts come later.
export function DraftsSection({ drafts }: { drafts: Drafts | null }) {
  if (!drafts) return null;
  const images = drafts.conversations.reduce((n, c) => n + c.images.length, 0);
  return (
    <details className="drafts">
      <summary>
        Thumbnail & Title Drafts{' '}
        <span className="muted small-text">
          · {drafts.brief ? 'brief, ' : ''}
          {drafts.conversations.length} {drafts.conversations.length === 1 ? 'conversation' : 'conversations'}, {images}{' '}
          {images === 1 ? 'image' : 'images'}
        </span>
      </summary>
      <div className="drafts-top">
        {drafts.brief && <TextToggle label="Brief" path={drafts.brief.path} />}
        <button className="small" onClick={() => openInExplorer('projects', drafts.path)}>
          Open Drafts Folder
        </button>
      </div>
      <div className="drafts-grid">
        {drafts.conversations.map((c) => (
          <Conversation key={c.path} conversation={c} />
        ))}
      </div>
    </details>
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

/** A button that shows or hides a text file from the drafts. */
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
      {open && (error ? <p className="error">{error}</p> : <pre>{text ?? 'Loading…'}</pre>)}
    </div>
  );
}
