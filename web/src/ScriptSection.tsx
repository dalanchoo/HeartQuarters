import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getJson, postJson } from './api';
import { CopyButton } from './PackagingDoc';
import type { ScriptFile } from '../../server/script';

export function ScriptSection({ piece, onSaved }: { piece: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<ScriptFile | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || file) return;
    let active = true;
    setError('');
    getJson<ScriptFile>(`/api/script?piece=${encodeURIComponent(piece)}`).then(
      (res) => {
        if (!active) return;
        setFile(res);
        setText(res.text);
      },
      (e: Error) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open, piece, file]);

  const dirty = file !== null && text !== file.text;

  const save = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setSavedNotice(false);
    try {
      const updated = await postJson<ScriptFile>('/api/script', { piece, text });
      setFile(updated);
      setText(updated.text);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleBullet = () => {
    const el = boxRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nextNl = text.indexOf('\n', end);
    const lineEnd = nextNl === -1 ? text.length : nextNl;
    const block = text.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allBulleted = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    const replaced = lines
      .map((l) => (allBulleted ? l.replace(/^\s*[-*•]\s+/, '') : `- ${l}`))
      .join('\n');
    const next = text.slice(0, lineStart) + replaced + text.slice(lineEnd);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + replaced.length);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) void save();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const el = e.currentTarget;
      const pos = el.selectionStart;
      if (pos !== el.selectionEnd) return;
      const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
      const currentLine = text.slice(lineStart, pos);
      const emptyBullet = /^(\s*[-*•]\s+)$/.exec(currentLine);
      if (emptyBullet) {
        e.preventDefault();
        const next = text.slice(0, lineStart) + text.slice(pos);
        setText(next);
        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
        return;
      }
      const bullet = /^(\s*[-*•]\s+)/.exec(currentLine);
      if (bullet) {
        e.preventDefault();
        const insert = `\n${bullet[1]}`;
        const next = text.slice(0, pos) + insert + text.slice(pos);
        setText(next);
        requestAnimationFrame(() => el.setSelectionRange(pos + insert.length, pos + insert.length));
      }
    }
  };

  return (
    <details className="yt-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Script</summary>
      {error && <p className="error" role="alert">{error}</p>}
      {!file && !error && <p className="muted small-text">Loading script…</p>}
      {file && (
        <div className="script-editor">
          <div className="yt-linkbar-row" style={{ marginTop: '0.5rem', marginBottom: '0.4rem' }}>
            <button type="button" className="small" onClick={toggleBullet} title="Add or remove bullet points on the selected lines">
              • Bullet List
            </button>
            <button type="button" className="small" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save Script'}
            </button>
            {dirty && (
              <button type="button" className="small" disabled={busy} onClick={() => setText(file.text)}>
                Discard Changes
              </button>
            )}
            {text.trim() && <CopyButton text={text} label="Copy Script" />}
            <span className="muted small-text">
              {file.name}
              {!file.exists && ' (will be created on save)'}
              {savedNotice && ' · Saved ✓'}
            </span>
          </div>
          <textarea
            ref={boxRef}
            className="script-textarea"
            rows={14}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Write freeform text or bullet points (start a line with - for a bullet)…"
          />
          <p className="muted small-text" style={{ margin: '0.3rem 0 0' }}>
            Start a line with <code>- </code> for a bullet point (Enter continues the list; Enter on an empty bullet ends it). Saves directly to the Word (.docx) file for Google Drive.
          </p>
        </div>
      )}
    </details>
  );
}
