import { useState, type ReactNode } from 'react';
import { AiSelect, useAiFor } from './AiChoice';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postJson } from './api';
import { applySuggestion, findAiTellSpans, findAiWritingTells, isProseFieldLabel, type AiTellSpan } from './aiWritingCheck';
import type { AiWritingReview, AiWritingSuggestion } from '../../server/ai-writing';
import { setFieldSuggestions } from './fieldSuggestions';

/**
 * Renders `text` (which starts at `offset` within the full string) with `<span className="ai-tell-mark">`
 * around any character range covered by `spans`, including hover tooltips explaining why it was flagged.
 */
export function renderTextWithAiTells(text: string, spans = findAiTellSpans(text), offset = 0): ReactNode {
  if (!text || spans.length === 0) return text;
  const start = offset;
  const end = offset + text.length;
  const overlapping = spans.filter((s) => s.end > start && s.start < end);
  if (overlapping.length === 0) return text;

  const points = new Set<number>([start, end]);
  for (const s of overlapping) {
    if (s.start > start && s.start < end) points.add(s.start);
    if (s.end > start && s.end < end) points.add(s.end);
  }
  const sorted = [...points].sort((a, b) => a - b);

  return sorted.slice(0, -1).map((a, i) => {
    const b = sorted[i + 1];
    const slice = text.slice(a - start, b - start);
    const active = overlapping.filter((s) => s.start <= a && s.end >= b);
    if (active.length === 0) return slice;
    const reasons = [...new Set(active.map((s) => s.reason))];
    const tooltip = `⚠ AI Tell: ${reasons.join(' • ')}`;
    return (
      <span key={a} className="ai-tell-mark" data-ai-tell={tooltip}>
        {slice}
      </span>
    );
  });
}

export function AiHighlightedText({ text }: { text: string }) {
  return <>{renderTextWithAiTells(text)}</>;
}

/**
 * The text with each suggestion still in it highlighted, in order. Clicking a highlight picks that suggestion.
 * Suggestions already used (or edited away) aren't marked.
 */
function SuggestionText({ text, suggestions, picked, onPick }: { text: string; suggestions: AiWritingSuggestion[]; picked: number | null; onPick: (index: number) => void }) {
  const parts: ReactNode[] = [];
  let at = 0;
  suggestions.forEach((s, i) => {
    const found = text.indexOf(s.find, at);
    if (found < 0) return;
    parts.push(text.slice(at, found));
    parts.push(
      // A span, not a button, so a highlighted sentence flows inside its paragraph like the rest of the text.
      <span
        role="button"
        tabIndex={0}
        key={i}
        className={`ai-suggestion-mark${picked === i ? ' picked' : ''}`}
        title={s.why}
        onClick={() => onPick(i)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(i);
          }
        }}
      >
        {s.find}
      </span>,
    );
    at = found + s.find.length;
  });
  parts.push(text.slice(at));
  return <pre className="lvy-value ai-suggestion-text">{parts}</pre>;
}

/**
 * Under a field: quick checks for common AI phrasing, and "Check for AI Writing", which asks the chosen AI for whole
 * sentences to rewrite. With `onReplace` (an editable field), a rewrite can be put straight into the field.
 */
export function AiWritingChecker({ text, label, onReplace, suggestionKey, action }: { text: string; label: string; onReplace?: (next: string) => void | Promise<void>; suggestionKey?: string; action?: ReactNode }) {
  // With an edit box above that underlines rewrites (it shares `suggestionKey`), the rewrites are shown there instead.
  const inBox = !!onReplace && !!suggestionKey;
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<AiWritingReview | null>(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [ai, setAi] = useAiFor('ai-writing');

  if (!isProseFieldLabel(label)) return null;
  const trimmed = text.trim();
  const tells = findAiWritingTells(trimmed);

  const checkWithAi = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await postJson<AiWritingReview>('/api/ai-writing-check', { text: trimmed, label, ai });
      setReview(result);
      if (suggestionKey) setFieldSuggestions(suggestionKey, result.suggestions);
      setPicked(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!trimmed && !review && !error) return action ? <div className="ai-writing-checker"><div className="ai-writing-bar">{action}</div></div> : null;

  const use = async (i: number) => {
    const s = review?.suggestions[i];
    if (!s) return;
    const next = applySuggestion(text, s.find, s.replace);
    if (next === null) return;
    setError('');
    if (onReplace) {
      try {
        await onReplace(next);
        setPicked(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } else {
      await navigator.clipboard.writeText(s.replace).catch(() => undefined);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    }
  };
  const suggestionCard = (s: AiWritingSuggestion, i: number) => {
    const open = text.includes(s.find);
    return (
      <li key={i} className={`ai-suggestion${picked === i ? ' picked' : ''}${open ? '' : ' used'}`}>
        <div><span className="ai-suggestion-label">Replace</span> <span className="ai-suggestion-find">{s.find}</span></div>
        <div><span className="ai-suggestion-label">With</span> <span className="ai-suggestion-replace">{s.replace}</span></div>
        {s.why && <div className="muted">{s.why}</div>}
        {open ? (
          <button type="button" className="small" onClick={() => void use(i)}>
            {onReplace ? 'Replace in Text' : copied === i ? 'Copied ✓' : 'Copy Rewrite'}
          </button>
        ) : (
          <div className="muted">✓ No longer in the text.</div>
        )}
      </li>
    );
  };

  return (
    <div className="ai-writing-checker">
      <div className="ai-writing-bar">
        {tells.length > 0 ? (
          <span className="ai-writing-badge ai-writing-badge--warn">
            ⚠ {tells.length} Possible AI {tells.length === 1 ? 'Tell' : 'Tells'}
          </span>
        ) : (
          <span className="ai-writing-badge ai-writing-badge--ok">✓ No Common AI Tells</span>
        )}
        <AiSelect value={ai} onChange={setAi} title="Which AI checks the writing" />
        <button type="button" className="small" disabled={busy || !trimmed} onClick={() => void checkWithAi()}>
          {busy ? 'Checking Writing…' : 'Check Writing'}
        </button>
        {review && (
          <button type="button" className="small" onClick={() => { setReview(null); if (suggestionKey) setFieldSuggestions(suggestionKey, []); }}>
            Hide Review
          </button>
        )}
        {action}
      </div>

      {tells.length > 0 && (
        <ul className="ai-writing-tells small-text">
          {tells.map((t, i) => (
            <li key={i}>
              <code>“{t.match}”</code> — <span className="muted">{t.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="error small-text" role="alert">
          {error}
        </p>
      )}

      {review && (
        <div className="ai-writing-review">
          <div className="small-text muted" style={{ marginBottom: '0.25rem' }}>
            <strong>{review.aiName} Writing Check:</strong>
          </div>
          {review.review && (
            <div className="markdown small-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{review.review}</ReactMarkdown>
            </div>
          )}
          {review.suggestions.length > 0 && (
            <>
              {inBox ? (
                <p className="small-text">The sentences that sound like AI are underlined in the box above. Click one to see its rewrite and accept it.</p>
              ) : (
                <>
                  <p className="small-text muted">Click a highlighted sentence to see its rewrite{onReplace ? ' and put it in' : ''}.</p>
                  <SuggestionText text={text} suggestions={review.suggestions} picked={picked} onPick={(i) => setPicked(picked === i ? null : i)} />
                </>
              )}
              {picked !== null && review.suggestions[picked] && <ul className="ai-suggestions small-text">{suggestionCard(review.suggestions[picked], picked)}</ul>}
              <details className="ai-suggestion-list small-text">
                <summary>All Suggestions, in Order ({review.suggestions.length})</summary>
                <ol className="ai-suggestions">{review.suggestions.map(suggestionCard)}</ol>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}
