import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useUnsavedWarning } from './unsavedEdits';
import DOMPurify from 'dompurify';
import { getJson, postJson } from './api';
import { AiWritingChecker } from './AiWritingChecker';
import { CopyButton } from './PackagingDoc';
import type { ScriptFile } from '../../server/script';

export function ScriptSection({ piece, onSaved }: { piece: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<ScriptFile | null>(null);
  const [html, setHtml] = useState('');
  const [plain, setPlain] = useState('');
  const [blockTag, setBlockTag] = useState('P');
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  const loadIntoEditor = (rawHtml: string, rawText: string) => {
    const clean = DOMPurify.sanitize(rawHtml);
    setHtml(clean);
    setPlain(rawText);
    if (editorRef.current) editorRef.current.innerHTML = clean;
  };

  useEffect(() => {
    if (!open || file) return;
    let active = true;
    setError('');
    getJson<ScriptFile>(`/api/script?piece=${encodeURIComponent(piece)}`).then(
      (res) => {
        if (!active) return;
        const clean = DOMPurify.sanitize(res.html);
        setFile({ ...res, html: clean });
        setHtml(clean);
        setPlain(res.text);
        requestAnimationFrame(() => {
          if (editorRef.current) editorRef.current.innerHTML = clean;
        });
      },
      (e: Error) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open, piece, file]);

  const syncFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    setHtml(DOMPurify.sanitize(el.innerHTML));
    setPlain(el.innerText);
  };

  const updateCurrentBlockTag = () => {
    const sel = window.getSelection();
    let node: Node | null = sel?.anchorNode ?? null;
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName;
        if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'BLOCKQUOTE' || tag === 'P') {
          setBlockTag(tag);
          return;
        }
      }
      node = node.parentNode;
    }
    setBlockTag('P');
  };

  const runCmd = (command: string, value?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    syncFromDom();
    updateCurrentBlockTag();
  };

  const dirty = file !== null && html !== file.html;
  // Refreshing or opening another project asks first while the script has unsaved changes.
  useUnsavedWarning(dirty);

  const save = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setSavedNotice(false);
    try {
      const currentHtml = editorRef.current ? DOMPurify.sanitize(editorRef.current.innerHTML) : html;
      const updated = await postJson<ScriptFile>('/api/script', { piece, html: currentHtml });
      const clean = DOMPurify.sanitize(updated.html);
      setFile({ ...updated, html: clean });
      setHtml(clean);
      setPlain(updated.text);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2000);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (dirty) void save();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      runCmd(e.shiftKey ? 'outdent' : 'indent');
    }
  };

  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <details className={`yt-section${dirty ? ' unsaved' : ''}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Script{dirty && <span className="unsaved-label">Unsaved Changes</span>}</summary>
      {error && <p className="error" role="alert">{error}</p>}
      {!file && !error && <p className="muted small-text">Loading script…</p>}
      {file && (
        <div className="script-editor">
          <div className="script-toolbar-row">
            <div className="script-toolbar" role="toolbar" aria-label="Script Formatting">
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('undo')} title="Undo (Ctrl+Z)">
                ↶
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('redo')} title="Redo (Ctrl+Y)">
                ↷
              </button>
              <span className="script-divider" aria-hidden="true" />
              <select
                className="script-heading-select"
                aria-label="Text Style"
                value={blockTag}
                onChange={(e) => {
                  const tag = e.target.value;
                  setBlockTag(tag);
                  runCmd('formatBlock', `<${tag.toLowerCase()}>`);
                }}
              >
                <option value="P">Normal Text</option>
                <option value="H1">Heading 1</option>
                <option value="H2">Heading 2</option>
                <option value="H3">Heading 3</option>
                <option value="BLOCKQUOTE">Quote</option>
              </select>
              <span className="script-divider" aria-hidden="true" />
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('bold')} title="Bold (Ctrl+B)">
                <strong>B</strong>
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('italic')} title="Italic (Ctrl+I)">
                <em>I</em>
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('underline')} title="Underline (Ctrl+U)">
                <u>U</u>
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('strikeThrough')} title="Strikethrough">
                <s>S</s>
              </button>
              <span className="script-divider" aria-hidden="true" />
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('insertOrderedList')} title="Numbered List">
                1.☰
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('insertUnorderedList')} title="Bulleted List">
                •☰
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('outdent')} title="Indent Less (Shift+Tab)">
                ⇤
              </button>
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('indent')} title="Indent More (Tab)">
                ⇥
              </button>
              <button
                type="button"
                className="script-tool"
                onMouseDown={keepFocus}
                onClick={() => runCmd('formatBlock', blockTag === 'BLOCKQUOTE' ? '<p>' : '<blockquote>')}
                title="Quote"
              >
                ❝
              </button>
              <span className="script-divider" aria-hidden="true" />
              <button type="button" className="script-tool" onMouseDown={keepFocus} onClick={() => runCmd('removeFormat')} title="Clear Formatting">
                Tₓ
              </button>
            </div>

            <div className="script-actions">
              <button type="button" className="small" disabled={!dirty || busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save Script'}
              </button>
              {dirty && (
                <button type="button" className="small" disabled={busy} onClick={() => loadIntoEditor(file.html, file.text)}>
                  Discard Changes
                </button>
              )}
              {plain.trim() && <CopyButton text={plain} label="Copy Script" />}
              <span className="muted small-text">
                {file.name}
                {!file.exists && ' (will be created on save)'}
                {savedNotice && ' · Saved ✓'}
              </span>
            </div>
          </div>

          {/* Cleaned with DOMPurify before display. */}
          <div
            ref={editorRef}
            className="script-rich-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Script Editor"
            data-placeholder="Write your script here…"
            onInput={syncFromDom}
            onKeyUp={updateCurrentBlockTag}
            onMouseUp={updateCurrentBlockTag}
            onKeyDown={onKeyDown}
          />
          <AiWritingChecker text={plain} label="YouTube Script" />
        </div>
      )}
    </details>
  );
}
