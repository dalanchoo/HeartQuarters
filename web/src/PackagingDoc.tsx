import { useEffect, useState } from 'react';
import { copyText, getText, type FileRef } from './api';

// Packaging files (YouTube.md etc.) are written as labelled blocks:
//
//   Title:
//   When Should You Tell Someone You Have SDAM?
//
//   Description:
//   ...
//
// This splits them into fields so each one gets its own Copy button.
interface Field {
  label: string;
  value: string;
}

const LABEL_RE = /^([A-Z][A-Za-z ]{0,30}):\s*$/;

export function parseFields(text: string): Field[] | null {
  const fields: { label: string; lines: string[] }[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const match = LABEL_RE.exec(line.trim());
    if (match) fields.push({ label: match[1], lines: [] });
    else if (fields.length) fields[fields.length - 1].lines.push(line);
  }
  if (fields.length < 2) return null;
  return fields.map((f) => ({ label: f.label, value: f.lines.join('\n').trim() }));
}

export function PackagingDoc({ file }: { file: FileRef }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getText('projects', file.path).then(setText, (e) => setError(e.message));
  }, [file.path]);

  const fields = text ? parseFields(text) : null;
  const isEmpty = text !== null && text.replace(/^#.*$/gm, '').trim() === '';

  return (
    <div className="block">
      <h4>
        {file.name}
        {text && !isEmpty && <CopyButton text={text} label="Copy all" />}
      </h4>
      {error && <p className="error">{error}</p>}
      {isEmpty && <p className="muted">Empty.</p>}
      {fields &&
        fields.map((f, i) => (
          <details key={i} className="field" open>
            <summary className="field-head">
              <strong>{f.label}</strong>
              {f.value && <CopyButton text={f.value} />}
            </summary>
            <div className="field-value">{f.value || <span className="muted">(empty)</span>}</div>
          </details>
        ))}
      {text && !fields && !isEmpty && <pre className="raw">{text}</pre>}
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
