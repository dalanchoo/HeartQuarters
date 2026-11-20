import { useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import type { AiWritingSuggestion } from '../../server/ai-writing';
import { applySuggestion, wordDiff } from './aiWritingCheck';
import { dropFieldSuggestion, useFieldSuggestions } from './fieldSuggestions';

/** Where each rewrite's sentence sits in `text`, in order, skipping any that are no longer there. */
function placed(text: string, suggestions: AiWritingSuggestion[]) {
  const out: { s: AiWritingSuggestion; start: number; end: number }[] = [];
  let from = 0;
  for (const s of suggestions) {
    const start = text.indexOf(s.find, from);
    if (start < 0) continue;
    out.push({ s, start, end: start + s.find.length });
    from = start + s.find.length;
  }
  return out;
}

// What the see-through layer copies from the box, so its words wrap in exactly the same places.
const COPIED = ['whiteSpace', 'overflowWrap', 'wordBreak', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing'] as const;

/**
 * A field's edit box that works like Grammarly: after "Check for AI Writing", each sentence the AI would rewrite is
 * underlined right where you type. Click one to see the change, word by word, and Accept it or Dismiss it.
 * The underlines are drawn on a see-through layer over the box, so typing and clicking work as usual.
 */
export function SuggestionTextarea({ suggestionKey, value, onAccept, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { suggestionKey?: string; value: string; onAccept?: (next: string) => void | Promise<void> }) {
  const all = useFieldSuggestions(onAccept ? suggestionKey : undefined);
  const marks = placed(value, all);
  const box = useRef<HTMLTextAreaElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<AiWritingSuggestion | null>(null);
  const [popup, setPopup] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState('');

  // Keep the layer the same shape as the box (and scrolled the same way) on every render.
  useLayoutEffect(() => {
    const t = box.current;
    const l = layer.current;
    if (!t || !l) return;
    const css = getComputedStyle(t);
    for (const name of COPIED) l.style[name] = css[name];
    l.style.borderStyle = 'solid';
    l.style.borderColor = 'transparent';
    l.style.width = `${t.offsetWidth - (t.offsetWidth - t.clientWidth - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth))}px`;
    l.style.height = `${t.offsetHeight}px`;
    l.scrollTop = t.scrollTop;
  });

  const placePopup = (s: AiWritingSuggestion) => {
    const mark = layer.current?.querySelector<HTMLElement>(`[data-mark="${all.indexOf(s)}"]`);
    const area = wrap.current?.getBoundingClientRect();
    const rects = mark?.getClientRects();
    if (!mark || !area || !rects?.length) return setPopup(null);
    const first = rects[0];
    const last = rects[rects.length - 1];
    setPopup({ top: last.bottom - area.top + 6, left: Math.max(0, Math.min(first.left - area.left, area.width - 380)) });
  };

  // Clicking (or moving the cursor) inside an underlined sentence opens its suggestion.
  const checkCursor = () => {
    const at = box.current?.selectionStart ?? -1;
    const hit = marks.find((m) => at >= m.start && at <= m.end);
    if (!hit) return setOpen(null);
    setError('');
    setOpen(hit.s);
    placePopup(hit.s);
  };

  const accept = async (s: AiWritingSuggestion) => {
    const next = applySuggestion(value, s.find, s.replace);
    if (next === null || !onAccept) return;
    try {
      await onAccept(next);
      if (suggestionKey) dropFieldSuggestion(suggestionKey, s);
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const shown = open && marks.some((m) => m.s === open) ? open : null;
  let at = 0;
  return (
    <div className="suggest-wrap" ref={wrap}>
      <textarea
        {...props}
        ref={box}
        value={value}
        onClick={(e) => { props.onClick?.(e); checkCursor(); }}
        onKeyUp={(e) => { props.onKeyUp?.(e); if (e.key.startsWith('Arrow')) checkCursor(); if (e.key === 'Escape') setOpen(null); }}
        onScroll={(e) => { props.onScroll?.(e); if (layer.current) layer.current.scrollTop = e.currentTarget.scrollTop; if (shown) placePopup(shown); }}
      />
      {marks.length > 0 && (
        <div className="suggest-layer" ref={layer} aria-hidden="true">
          {marks.map((m) => {
            const before = value.slice(at, m.start);
            at = m.end;
            return (
              <span key={m.start}>
                {before}
                <span className={`suggest-mark${shown === m.s ? ' open' : ''}`} data-mark={all.indexOf(m.s)}>{value.slice(m.start, m.end)}</span>
              </span>
            );
          })}
          {value.slice(at)}
          {'\n'}
        </div>
      )}
      {shown && popup && (
        <div className="suggest-popup" style={{ top: popup.top, left: popup.left }} role="dialog" aria-label="Suggested rewrite">
          <div className="suggest-popup-head">
            <span>Sounds Like AI</span>
            <button type="button" className="suggest-close" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
          </div>
          <p className="suggest-diff">
            {wordDiff(shown.find, shown.replace).map((part, i) => (
              <span key={i} className={`suggest-${part.kind}`}>{part.text}</span>
            ))}
          </p>
          {shown.why && <p className="suggest-why">{shown.why}</p>}
          <div className="suggest-actions">
            <button type="button" className="small" onClick={() => void accept(shown)}>Accept</button>
            <button type="button" className="small" onClick={() => { if (suggestionKey) dropFieldSuggestion(suggestionKey, shown); setOpen(null); }}>Dismiss</button>
          </div>
          {error && <p className="error small-text">{error}</p>}
        </div>
      )}
    </div>
  );
}
