import { useEffect, useState } from 'react';
import { copyText, getText, type FileRef } from './api';
import { parseFields } from './packaging';

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
