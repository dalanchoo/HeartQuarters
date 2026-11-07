import { useEffect, useState } from 'react';
import { copyText, getText, type FileRef } from './api';
import { parseFields, type Field } from './packaging';

/** Long fields go full width under the card; short ones sit beside the cover. */
export function isWideField(label: string): boolean {
  return /^description$/i.test(label);
}

export interface LoadedDoc {
  file: FileRef;
  text: string | null; // null while loading
  error: string | null;
  fields: Field[] | null; // null if the file isn't in "Label:" format
}

/** Loads a set of packaging files (e.g. one version's YouTube.md, TikTok.md...). */
export function usePackagingDocs(files: FileRef[]): LoadedDoc[] {
  const key = files.map((f) => f.path).join('|');
  const [docs, setDocs] = useState<LoadedDoc[]>([]);

  useEffect(() => {
    let stale = false; // set when you switch version before these have loaded
    const blank = files.map((file) => ({ file, text: null, error: null, fields: null }));
    setDocs(blank);
    files.forEach((file, i) => {
      getText('projects', file.path).then(
        (text) => {
          if (stale) return;
          setDocs((prev) => prev.map((d, j) => (j === i ? { ...d, text, fields: parseFields(text) } : d)));
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

function FieldView({ field, title }: { field: Field; title?: string }) {
  return (
    <details className="field" open>
      <summary className="field-head">
        <strong>{title ?? field.label}</strong>
        {field.value && <CopyButton text={field.value} />}
      </summary>
      <div className="field-value">{field.value || <span className="muted">(empty)</span>}</div>
    </details>
  );
}

/** One file's heading and its short fields (Title, Tags, Pinned Comment...). */
export function PackagingDocShort({ doc }: { doc: LoadedDoc }) {
  const { file, text, error, fields } = doc;
  const isEmpty = text !== null && text.replace(/^#.*$/gm, '').trim() === '';
  return (
    <div className="block">
      <h4>
        {file.name}
        {text && !isEmpty && <CopyButton text={text} label="Copy all" />}
      </h4>
      {error && <p className="error">{error}</p>}
      {text === null && !error && <p className="muted">Loading…</p>}
      {isEmpty && <p className="muted">Empty.</p>}
      {fields?.filter((f) => !isWideField(f.label)).map((f, i) => <FieldView key={i} field={f} />)}
      {text && !fields && !isEmpty && <pre className="raw">{text}</pre>}
    </div>
  );
}

/** The long fields (Description) of every file, shown full width below the card's columns. */
export function PackagingDocsWide({ docs }: { docs: LoadedDoc[] }) {
  const wide = docs.flatMap((doc) =>
    (doc.fields ?? []).filter((f) => isWideField(f.label)).map((field) => ({ doc, field })),
  );
  if (wide.length === 0) return null;
  const several = docs.length > 1;
  return (
    <div className="piece-wide">
      {wide.map(({ doc, field }) => (
        <FieldView
          key={doc.file.path + field.label}
          field={field}
          title={several ? `${field.label} (${doc.file.name})` : field.label}
        />
      ))}
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
