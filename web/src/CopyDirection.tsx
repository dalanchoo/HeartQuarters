import type { ReactNode } from 'react';

export type CopyDirection = 'left-to-right' | 'right-to-left';

/** The same direction controls and pending-copy outline for local and YouTube comparisons. */
export function CopyDirectionControls({ left, right, selected, canCopyRight, canCopyLeft, copyRight, copyLeft }: { left: string; right: string; selected: CopyDirection | null; canCopyRight: boolean; canCopyLeft: boolean; copyRight: () => void; copyLeft: () => void }) {
  return <div className="copy-direction-controls" role="group" aria-label={`Choose a copy direction between ${left} and ${right}`}>
    <button type="button" className={`small copy-direction-button${selected === 'left-to-right' ? ' is-selected' : ''}`} aria-pressed={selected === 'left-to-right'} disabled={!canCopyRight} onClick={copyRight} title={selected === 'left-to-right' ? 'Click again to cancel this copy' : `Copy from ${left} to ${right}`}>
      {left} → {right}
    </button>
    <button type="button" className={`small copy-direction-button${selected === 'right-to-left' ? ' is-selected' : ''}`} aria-pressed={selected === 'right-to-left'} disabled={!canCopyLeft} onClick={copyLeft} title={selected === 'right-to-left' ? 'Click again to cancel this copy' : `Copy from ${right} to ${left}`}>
      {left} ← {right}
    </button>
  </div>;
}

export function CopyDirectionFrame({ left, right, selected, children }: { left: string; right: string; selected: CopyDirection | null; children: ReactNode }) {
  return <div className={`copy-direction-frame${selected ? ' is-pending' : ''}`}>
    {selected && <div className="copy-direction-notice" role="status">{selected === 'left-to-right' ? <>{left} <span aria-hidden="true">⟶</span> {right}</> : <>{left} <span aria-hidden="true">⟵</span> {right}</>} <span className="copy-direction-notice-detail">Selected for Apply Changes</span></div>}
    {children}
  </div>;
}

export function youtubeCopyDirection(reverse: boolean, toYoutube: boolean, fromYoutube: boolean): CopyDirection | null {
  if (toYoutube) return reverse ? 'right-to-left' : 'left-to-right';
  if (fromYoutube) return reverse ? 'left-to-right' : 'right-to-left';
  return null;
}

export function localCopyDirection(selected: boolean, targetIsRight: boolean): CopyDirection | null {
  return selected ? targetIsRight ? 'left-to-right' : 'right-to-left' : null;
}
