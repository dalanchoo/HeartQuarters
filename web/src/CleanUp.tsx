import { useState } from 'react';
import { formatSize, getJson, postJson } from './api';
import type { CleanupItem, CleanupPlan } from '../../server/cleanup';

/**
 * Clean Up This Video: once it's done, everything not in its CapCut projects or on YouTube goes to HeartQuarters Trash
 * (server/cleanup.ts). The list comes first; nothing moves until John approves it, and Trash keeps everything.
 */
export function CleanUp({ piece, onDone, intro }: { piece: string; onDone?: () => void; intro?: string }) {
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const look = () => {
    setBusy(true);
    setError('');
    setResult('');
    getJson<CleanupPlan>(`/api/cleanup?piece=${encodeURIComponent(piece)}`)
      .then(setPlan, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const run = () => {
    if (!plan) return;
    if (!window.confirm(`Move ${plan.remove.length} files (${formatSize(plan.freed)}) to HeartQuarters Trash${plan.move.length ? ` and move ${plan.move.length} into Intermediate` : ''}? CapCut must be closed. Everything can be moved back from Trash.`)) return;
    setBusy(true);
    setError('');
    postJson<{ removed: number; moved: number; freed: number; trash: string }>('/api/cleanup', { piece, token: plan.token })
      .then((r) => {
        setResult(`Done: ${r.removed} files (${formatSize(r.freed)}) are in HeartQuarters Trash, at ${r.trash}.${r.moved ? ` ${r.moved} moved into Intermediate, with CapCut pointed at them.` : ''}`);
        setPlan(null);
        onDone?.();
        window.dispatchEvent(new Event('hq-cleanup-done')); // the Videos page's Can Clean Up badges check again
      }, (e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  // The files to go, grouped by why, biggest group first.
  const groups = plan ? Object.entries(plan.remove.reduce<Record<string, CleanupItem[]>>((g, i) => ({ ...g, [i.why]: [...(g[i.why] ?? []), i] }), {})).sort((a, b) => b[1].reduce((n, i) => n + i.size, 0) - a[1].reduce((n, i) => n + i.size, 0)) : [];
  // Paths shown from the piece's own folder; the longform's retention graphs from the video's.
  const short = (p: string) => (p.startsWith(`${piece}/`) ? p.slice(piece.length + 1) : p.split('/').slice(-2).join('/'));

  return (
    <details className="yt-section clean-up">
      <summary>Clean Up</summary>
      <p className="muted small-text">
        {intro ??
          "When this is finished: everything that isn't in its CapCut project or on YouTube goes to HeartQuarters Trash, as if you'd made it by hand. Raw, Exports, Subtitles, the packaging versions and your own thumbnail files always stay."}{' '}
        You see the list first, and anything can be moved back from Trash.
      </p>
      {!plan && (
        <button disabled={busy} onClick={look}>
          {busy ? 'Reading the CapCut projects…' : 'Show What Would Go'}
        </button>
      )}
      {plan && plan.missing.length > 0 && (
        <div className="clean-up-missing">
          <p className="error">
            Clean Up can&apos;t run yet: the CapCut {plan.missing.length === 1 ? 'project has a link' : 'projects have links'} to {plan.missing.length === 1 ? 'a file' : `${plan.missing.length} files`} that{' '}
            {plan.missing.length === 1 ? "isn't" : "aren't"} there. CapCut may be looking for {plan.missing.length === 1 ? 'it' : 'them'} somewhere else, so files that look unused
            could be the ones it needs. Open the project in CapCut, relink or remove {plan.missing.length === 1 ? 'it' : 'them'}, then click Check Again.
          </p>
          <ul className="small-text">{plan.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          <button className="small" disabled={busy} onClick={look}>
            Check Again
          </button>
        </div>
      )}
      {plan && plan.missing.length === 0 && (
        <>
          {plan.remove.length === 0 && plan.move.length === 0 ? (
            <p>Nothing to clean up.</p>
          ) : (
            <p>
              <strong>{plan.remove.length} files, {formatSize(plan.freed)},</strong> would go to HeartQuarters Trash.
              {plan.move.length > 0 && ` ${plan.move.length} files CapCut uses would move from Claude into Intermediate.`}
            </p>
          )}
          {groups.map(([why, items]) => (
            <details key={why} className="clean-up-group">
              <summary>
                {why[0].toUpperCase() + why.slice(1)} <span className="muted">· {items.length} {items.length === 1 ? 'file' : 'files'}, {formatSize(items.reduce((n, i) => n + i.size, 0))}</span>
              </summary>
              <ul className="small-text">{items.map((i) => <li key={i.path}>{short(i.path)} <span className="muted">({formatSize(i.size)})</span></li>)}</ul>
            </details>
          ))}
          {plan.move.length > 0 && (
            <details className="clean-up-group">
              <summary>Move into Intermediate <span className="muted">· {plan.move.length} {plan.move.length === 1 ? 'file' : 'files'} CapCut uses</span></summary>
              <ul className="small-text">{plan.move.map((i) => <li key={i.path}>{short(i.path)} → {short(i.to!)}</li>)}</ul>
            </details>
          )}
          {plan.skipped.length > 0 && <p className="muted small-text">Left alone (shortcuts or junctions): {plan.skipped.map(short).join(', ')}</p>}
          <div className="draft-use">
            {(plan.remove.length > 0 || plan.move.length > 0) && (
              <button disabled={busy} onClick={run}>
                {busy ? 'Cleaning up…' : 'Move These to Trash'}
              </button>
            )}
            <button className="small" disabled={busy} onClick={look}>
              Check Again
            </button>
          </div>
        </>
      )}
      {result && <p className="picked-label">{result}</p>}
      {error && <p className="error">{error}</p>}
    </details>
  );
}
