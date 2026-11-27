import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useUnsavedWarning } from './unsavedEdits';
import DOMPurify from 'dompurify';
import { getJson, postJson } from './api';
import { AiWritingChecker } from './AiWritingChecker';
import { CopyButton } from './PackagingDoc';
import type { ScriptFile } from '../../server/script';
import { openScriptWindow } from './scriptWindow';
import { defaultScriptFormatting, readScriptFormatting } from './scriptFormatting';

export function ScriptSection({ piece, onSaved }: { piece: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<ScriptFile | null>(null);
  const [html, setHtml] = useState('');
  const [plain, setPlain] = useState('');
  const [{ blockTag, active }, setFormatting] = useState(defaultScriptFormatting);
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState('');
  const [lockedByOther, setLockedByOther] = useState(false);
  const [openAttempt, setOpenAttempt] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);
  const initialHtml = useRef('');
  const attachEditor = useCallback((editor: HTMLDivElement | null) => {
    editorRef.current = editor;
    if (editor) editor.innerHTML = initialHtml.current;
  }, []);
  const inlineRef = useRef<HTMLDivElement>(null);
  const windowButton = useRef<HTMLButtonElement>(null);
  // Keep the portal target the same when moving the editor between windows.
  const [editorHost] = useState(() => document.createElement('div'));
  const [popup, setPopup] = useState<ReturnType<typeof openScriptWindow>>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  useLayoutEffect(() => {
    inlineRef.current?.append(editorHost);
  }, [editorHost]);

  useEffect(() => () => popup?.dispose(), [popup]);

  const popOut = () => {
    const next = openScriptWindow(editorHost, `Script — ${piece.split(/[\\/]/)[0]}`, () => {
      setPopup(null);
      requestAnimationFrame(() => windowButton.current?.focus());
    });
    setPopupBlocked(!next);
    setPopup(next);
  };

  const loadIntoEditor = (rawHtml: string, rawText: string) => {
    const clean = DOMPurify.sanitize(rawHtml);
    setHtml(clean);
    setPlain(rawText);
    if (editorRef.current) editorRef.current.innerHTML = clean;
  };

  const editing = open || file !== null;
  useEffect(() => {
    if (!editing) return;
    let active = true;
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    setLockedByOther(false);
    setError('');

    const load = async () => {
      const res = await getJson<ScriptFile>(`/api/script?piece=${encodeURIComponent(piece)}`);
      if (!active) return;
      const clean = DOMPurify.sanitize(res.html);
      initialHtml.current = clean;
      setFile({ ...res, html: clean });
      setHtml(clean);
      setPlain(res.text);
    };
    const showError = (e: unknown) => { if (active) setError(e instanceof Error ? e.message : String(e)); };
    if (navigator.locks) {
      const key = `heartquarters-script:${piece.toLowerCase()}`;
      void navigator.locks.request(key, { ifAvailable: true }, async lock => {
        if (!active) return;
        if (!lock) {
          setLockedByOther(true);
          return;
        }
        void load().catch(showError);
        await released;
      }).catch(showError);
    } else {
      // The engine still checks the saved revision when Web Locks are unavailable.
      void load().catch(showError);
    }
    return () => {
      active = false;
      release();
    };
  }, [editing, piece, openAttempt]);

  const updateFormatting = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const next = readScriptFormatting(editor);
    setFormatting(current => current.blockTag === next.blockTag && current.active.join() === next.active.join() ? current : next);
  }, []);

  const hasFile = file !== null;
  useEffect(() => {
    const page = editorRef.current?.ownerDocument;
    if (!page) return;
    // The editor changes documents when it pops out or back in.
    updateFormatting();
    page.addEventListener('selectionchange', updateFormatting);
    return () => page.removeEventListener('selectionchange', updateFormatting);
  }, [hasFile, popup, updateFormatting]);

  const syncFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    setHtml(DOMPurify.sanitize(el.innerHTML));
    setPlain(el.innerText);
    updateFormatting();
  };

  const runCmd = (command: string, value?: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    el.ownerDocument.execCommand(command, false, value);
    syncFromDom();
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
      const updated = await postJson<ScriptFile>('/api/script', { piece, html: currentHtml, revision: file.revision });
      const clean = DOMPurify.sanitize(updated.html);
      setFile({ ...updated, html: clean });
      if (currentHtml === DOMPurify.sanitize(editorRef.current?.innerHTML ?? currentHtml)) {
        setHtml(clean);
        setPlain(updated.text);
      }
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
  const windowAction = popup ? 'Focus Script Window' : 'Pop Out Script';
  const popOutButton = (
    <button ref={windowButton} type="button" className="script-icon-button" aria-label={windowAction} title={windowAction} onClick={popup ? popup.focus : popOut}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3z" />
      </svg>
    </button>
  );

  const editor = (
    <>
      {popup && (
        <header className="script-window-actions">
          <h1>Script</h1>
          {dirty && <span className="unsaved-label">Unsaved Changes</span>}
        </header>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {lockedByOther && (
        <div className="script-window-actions">
          <span role="status">This script is already open for editing in another HeartQuarters tab.</span>
          <button type="button" className="small" onClick={() => setOpenAttempt(attempt => attempt + 1)}>Try Again</button>
        </div>
      )}
      {!file && !error && !lockedByOther && <p className="muted small-text">Loading script…</p>}
      {file && (
        <div className="script-editor">
          <div className="script-file muted small-text" role="status">
            {file.name}
            {!file.exists && ' (will be created on save)'}
            {busy ? ' · Saving…' : savedNotice && !dirty && ' · Saved ✓'}
          </div>
          <div className="script-toolbar-row">
            <div className="script-formatting">
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
                  onChange={(e) => runCmd('formatBlock', `<${e.target.value.toLowerCase()}>`)}
                >
                  <option value="P">Normal Text</option>
                  <option value="H1">Heading 1</option>
                  <option value="H2">Heading 2</option>
                  <option value="H3">Heading 3</option>
                  <option value="BLOCKQUOTE">Quote</option>
                </select>
                <span className="script-divider" aria-hidden="true" />
                <button type="button" className="script-tool" aria-pressed={active.includes('bold')} aria-label="Bold" onMouseDown={keepFocus} onClick={() => runCmd('bold')} title="Bold (Ctrl+B)">
                  <strong>B</strong>
                </button>
                <button type="button" className="script-tool" aria-pressed={active.includes('italic')} aria-label="Italic" onMouseDown={keepFocus} onClick={() => runCmd('italic')} title="Italic (Ctrl+I)">
                  <em>I</em>
                </button>
                <button type="button" className="script-tool" aria-pressed={active.includes('underline')} aria-label="Underline" onMouseDown={keepFocus} onClick={() => runCmd('underline')} title="Underline (Ctrl+U)">
                  <u>U</u>
                </button>
                <button type="button" className="script-tool" aria-pressed={active.includes('strikeThrough')} aria-label="Strikethrough" onMouseDown={keepFocus} onClick={() => runCmd('strikeThrough')} title="Strikethrough">
                  <s>S</s>
                </button>
                <span className="script-divider" aria-hidden="true" />
                <button type="button" className="script-tool" aria-pressed={active.includes('insertOrderedList')} aria-label="Numbered List" onMouseDown={keepFocus} onClick={() => runCmd('insertOrderedList')} title="Numbered List">
                  1.☰
                </button>
                <button type="button" className="script-tool" aria-pressed={active.includes('insertUnorderedList')} aria-label="Bulleted List" onMouseDown={keepFocus} onClick={() => runCmd('insertUnorderedList')} title="Bulleted List">
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
                  aria-pressed={blockTag === 'BLOCKQUOTE'}
                  aria-label="Quote"
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

              <button type="button" className="script-icon-button" disabled={!dirty || busy} onClick={() => void save()} aria-label="Save Script" title="Save Script (Ctrl+S)">
                <span aria-hidden="true">💾</span>
              </button>
            </div>
            <div className="script-actions">
              {dirty && (
                <button type="button" className="small" disabled={busy} onClick={() => loadIntoEditor(file.html, file.text)}>
                  Discard Changes
                </button>
              )}
              {plain.trim() && <CopyButton text={plain} label="Copy Script" />}
              {popup ? (
                <button type="button" className="script-icon-button" aria-label="Pop In Script" title="Pop In Script" onClick={popup.close}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="m5 5 14 14m0-9v9h-9" />
                  </svg>
                </button>
              ) : popOutButton}
            </div>
          </div>
          {popupBlocked && <p className="error" role="alert">Allow pop-ups for HeartQuarters and try again.</p>}

          {/* Cleaned with DOMPurify before display. */}
          <div
            ref={attachEditor}
            className="script-rich-editor"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Script Editor"
            data-placeholder="Write your script here…"
            onInput={syncFromDom}
            onKeyUp={updateFormatting}
            onKeyDown={onKeyDown}
          />
          <AiWritingChecker text={plain} label="YouTube Script" />
        </div>
      )}
    </>
  );

  return (
    <details className={`yt-section${dirty ? ' unsaved' : ''}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Script{dirty && <span className="unsaved-label">Unsaved Changes</span>}</summary>
      {popup && <div className="script-toolbar-row"><div className="script-actions">{popOutButton}</div></div>}
      <div ref={inlineRef} />
      {createPortal(editor, editorHost)}
    </details>
  );
}
