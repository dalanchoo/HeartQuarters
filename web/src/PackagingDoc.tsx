import { useEffect, useState } from 'react';
import { copyText, getText, postJson, type FileRef } from './api';
import { setLocalValue } from './youtubePackaging';
import {
  inPlatformOrder,
  isBlankPackaging,
  parseFields,
  readAiLines,
  setAiLines,
  setFieldValue,
  type AiLines,
  type Field,
} from './packaging';

/** Long fields go full width under the card; short ones sit beside the cover. */
export function isWideField(label: string): boolean {
  return /^description$/i.test(label);
}

export interface LoadedDoc {
  file: FileRef;
  text: string | null; // null while loading
  error: string | null;
  fields: Field[] | null; // null if the file isn't in "Label:" format
  /** Changes the file: `change` gets its latest text and returns the new text. Changes are saved one at a time. */
  save: (change: (text: string) => string) => Promise<void>;
}

/** Loads a set of packaging files (e.g. one version's YouTube.md, TikTok.md...). A new `loads` number reads them again. */
export function usePackagingDocs(found: FileRef[], loads = 0): LoadedDoc[] {
  const files = inPlatformOrder(found);
  const key = `${loads}|${files.map((f) => f.path).join('|')}`;
  const [docs, setDocs] = useState<LoadedDoc[]>([]);

  useEffect(() => {
    let stale = false; // set when you switch version before these have loaded
    const show = (i: number, text: string) => {
      if (!stale) setDocs((prev) => prev.map((d, j) => (j === i ? { ...d, text, fields: parseFields(text) } : d)));
    };
    // Each file's newest text, and its waiting line of saves. Leaving a field by clicking a checkbox makes two changes
    // at once, and the second must start from the text the first one saved.
    const latest = files.map(() => '');
    const line = files.map(() => Promise.resolve());
    const blank = files.map((file, i) => ({
      file,
      text: null,
      error: null,
      fields: null,
      save: (change: (text: string) => string) => {
        const run = line[i].then(async () => {
          const was = latest[i];
          const text = change(was);
          if (text === was) return;
          await postJson('/api/packaging/save', { path: file.path, text, was });
          latest[i] = text;
          show(i, text);
        });
        line[i] = run.catch(() => {}); // a failed save is reported by whoever asked; the next one still gets its turn
        return run;
      },
    }));
    setDocs(blank);
    files.forEach((file, i) => {
      getText('projects', file.path).then(
        (text) => {
          latest[i] = text;
          show(i, text);
        },
        (e) => {
          if (stale) return;
          setDocs((prev) => prev.map((d, j) => (j === i ? { ...d, error: e.message } : d)));
        },
      );
    });
    return () => {
      stale = true;
    };
  }, [key]);

  return docs;
}

/** One field, editable where it stands. It saves when you leave the box, like the app's other boxes. */
function FieldView({ doc, index, field }: { doc: LoadedDoc; index: number; field: Field }) {
  const [draft, setDraft] = useState(field.value);
  const [status, setStatus] = useState<'saving' | 'saved' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(field.value), [field.value]);

  const commit = () => {
    const value = draft.trim();
    if (value === field.value) return setDraft(value);
    setStatus('saving');
    setError(null);
    doc.save((text) => setFieldValue(text, index, value)).then(
      () => {
        setDraft(value);
        setStatus('saved');
        setTimeout(() => setStatus(null), 1500);
      },
      // What was typed stays in the box, so it isn't lost.
      (e: Error) => {
        setStatus(null);
        setError(e.message);
      },
    );
  };

  return (
    <details className="field" open>
      <summary className="field-head">
        <strong>{field.label}</strong>
        {draft && <CopyButton text={draft} />}
        {status && <span className="muted small-text">{status === 'saving' ? 'Saving…' : 'Saved ✓'}</span>}
      </summary>
      <textarea
        className="field-value field-input"
        aria-label={field.label}
        placeholder="(empty)"
        spellCheck
        rows={draft.split('\n').length}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {error && <p className="error small-text">Not saved: {error}</p>}
    </details>
  );
}

/** Two checkboxes that put the AI-generated lines into a YouTube description, or take them out. The file is the record. */
function AiLineBoxes({ doc }: { doc: LoadedDoc }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = doc.text === null || !/(^|\/)youtube\b/i.test(doc.file.name) ? null : readAiLines(doc.text);
  if (!has) return null;

  const change = (want: AiLines) => {
    setSaving(true);
    setError(null);
    doc
      .save((text) => setAiLines(text, want))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="ai-lines small-text">
      <label>
        <input type="checkbox" checked={has.music} disabled={saving} onChange={(e) => change({ ...has, music: e.target.checked })} />
        The music is AI-generated
      </label>
      <label>
        <input type="checkbox" checked={has.visuals} disabled={saving} onChange={(e) => change({ ...has, visuals: e.target.checked })} />
        Some B-roll is AI-generated
      </label>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// Every YouTube.md shows these, so a longform and a short look the same even when one file doesn't have them yet.
const YOUTUBE_SETTINGS = ['Video language', 'Made for kids', 'Altered content'] as const;

/** The YouTube settings a YouTube.md doesn't have yet, each with a button that adds it to the file. */
function MissingYoutubeSettings({ doc }: { doc: LoadedDoc }) {
  const [error, setError] = useState<string | null>(null);
  if (!doc.fields || !/(^|\/)youtube\b/i.test(doc.file.name)) return null;
  const has = new Set(doc.fields.map((f) => f.label.toLowerCase()));
  const missing = YOUTUBE_SETTINGS.filter((label) => !has.has(label.toLowerCase()));
  if (missing.length === 0) return null;
  return (
    <>
      {missing.map((label) => (
        <div className="field missing-setting" key={label}>
          <div className="field-head">
            <strong>{label}</strong>
            <span className="muted small-text">Not in this file yet</span>
            <button
              className="small"
              onClick={() => {
                setError(null);
                doc.save((text) => setLocalValue(text, label, '')).catch((e: Error) => setError(e.message));
              }}
            >
              Add
            </button>
          </div>
        </div>
      ))}
      {error && <p className="error small-text">{error}</p>}
    </>
  );
}

/** One file's heading and its short fields (Title, Tags, Pinned Comment...). */
export function PackagingDocShort({ doc }: { doc: LoadedDoc }) {
  const { file, text, error, fields } = doc;
  const isEmpty = text !== null && text.replace(/^#.*$/gm, '').trim() === '';
  return (
    <div className="block">
      <h4>
        Local file · {file.name}
        {text && !isEmpty && <CopyButton text={text} label="Copy all" />}
      </h4>
      {error && <p className="error">{error}</p>}
      {text === null && !error && <p className="muted">Loading…</p>}
      {isEmpty && <p className="muted">Empty.</p>}
      <AiLineBoxes doc={doc} />
      {fields?.map((f, i) => !isWideField(f.label) && <FieldView key={i} doc={doc} index={i} field={f} />)}
      <MissingYoutubeSettings doc={doc} />
      {text && !fields && !isEmpty && <pre className="raw">{text}</pre>}
    </div>
  );
}

/** Another platform's file, whole. */
function PackagingDocWhole({ doc }: { doc: LoadedDoc }) {
  const { file, text, error, fields } = doc;
  return (
    <div className="block">
      <h4>
        {file.name}
        {text && !isBlankPackaging(text) && <CopyButton text={text} label="Copy all" />}
      </h4>
      {error && <p className="error">{error}</p>}
      {fields?.map((f, i) => <FieldView key={i} doc={doc} index={i} field={f} />)}
      {!fields && text && <pre className="raw">{text}</pre>}
      {!fields && !text && !error && <p className="muted small-text">This file is completely empty, so it has no fields to fill in.</p>}
    </div>
  );
}

/** Full width, below the card's columns: the main file's Description. */
export function PackagingDocsWide({ docs }: { docs: LoadedDoc[] }) {
  const main = docs[0];
  if (!main?.fields?.some((f) => isWideField(f.label))) return null;
  return (
    <div className="piece-wide">
      {main.fields.map((f, i) => isWideField(f.label) && <FieldView key={main.file.path + i} doc={main} index={i} field={f} />)}
    </div>
  );
}

/**
 * At the very bottom of the card, below YouTube's settings: the other platforms' files. Files nobody has filled in
 * share one line, so they take no room until you click one to write it.
 */
export function PackagingOtherPlatforms({ docs }: { docs: LoadedDoc[] }) {
  const [opened, setOpened] = useState<string[]>([]);
  const others = docs.slice(1);
  const isClosed = (d: LoadedDoc) => d.text !== null && isBlankPackaging(d.text) && !opened.includes(d.file.path);
  const closed = others.filter(isClosed);
  const shown = others.filter((d) => !isClosed(d) && (d.error || d.text !== null));
  if (others.length === 0) return null;
  return (
    <div className="piece-wide other-platforms">
      <h4>Other platforms</h4>
      {shown.map((d) => (
        <PackagingDocWhole key={d.file.path} doc={d} />
      ))}
      {closed.length > 0 && (
        <div className="not-written small-text">
          <span className="muted">Not written yet:</span>
          {closed.map((d) => (
            <button key={d.file.path} className="small" onClick={() => setOpened([...opened, d.file.path])}>
              {d.file.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  return (
    <button
      className="small"
      onClick={async (e) => {
        // Don't let the click also open/close the section the button sits in.
        e.preventDefault();
        e.stopPropagation();
        setResult((await copyText(text)) ? 'copied' : 'failed');
        setTimeout(() => setResult(null), 1500);
      }}
    >
      {result === 'copied' ? 'Copied ✓' : result === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
