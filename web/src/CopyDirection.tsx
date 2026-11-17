import { useId, type ReactNode } from 'react';

export type CopyDirection = 'left-to-right' | 'right-to-left';

/** The same direction controls and pending-copy outline for local and YouTube comparisons. */
export function CopyDirectionControls({ left, right, selected, canCopyRight, canCopyLeft, copyRight, copyLeft, disabled = false }: { left: string; right: string; selected: CopyDirection | null; canCopyRight: boolean; canCopyLeft: boolean; copyRight: () => void; copyLeft: () => void; disabled?: boolean }) {
  const name = useId();
  return <fieldset className="copy-direction-controls">
    <legend>Copy Direction</legend>
    <label className="copy-direction-option"><input type="radio" name={name} checked={selected === null} disabled={disabled} onChange={() => { if (selected === 'left-to-right') copyRight(); else if (selected === 'right-to-left') copyLeft(); }} /> No Copy</label>
    <label className="copy-direction-option"><input type="radio" name={name} checked={selected === 'left-to-right'} disabled={disabled || !canCopyRight} onChange={copyRight} /> {left} → {right}</label>
    <label className="copy-direction-option"><input type="radio" name={name} checked={selected === 'right-to-left'} disabled={disabled || !canCopyLeft} onChange={copyLeft} /> {left} ← {right}</label>
  </fieldset>;
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
