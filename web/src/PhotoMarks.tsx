// The marks on an expression photo, drawn the same way everywhere (Library tiles, the photo viewer, the Likeness
// Photos picker and the filters): Reference Photo, Star, and a rounded box holding Like / Meh / Dislike.
// Star and Reference Photo are separate: a photo can have either, both or neither. Only one rating at a time.
import type { ReactNode } from 'react';
import type { Rating, RatingChoice } from './expressionRating';

const RATINGS: { value: Rating; label: string }[] = [
  { value: 'liked', label: 'Like' },
  { value: 'meh', label: 'Meh' },
  { value: 'disliked', label: 'Dislike' },
];

/** Buttons that change a photo's marks. Leave out a handler to leave that button out. */
export function PhotoMarks({ starred, onToggleStar, starDisabled, reference, onToggleReference, referenceDisabled, rating, onRate, small }: {
  starred?: boolean; onToggleStar?: () => void; starDisabled?: boolean;
  reference?: boolean; onToggleReference?: () => void; referenceDisabled?: boolean;
  rating?: Rating; onRate?: (rating: Rating | null) => void; small?: boolean;
}) {
  return <span className={`photo-marks${small ? ' is-small' : ''}`}>
    {onToggleReference && <MarkButton kind="reference" on={!!reference} disabled={referenceDisabled} label={reference ? 'Reference Photo (click to remove)' : 'Make Reference Photo'} onClick={onToggleReference}><ReferenceIcon /></MarkButton>}
    {onToggleStar && <MarkButton kind="star" on={!!starred} disabled={starDisabled} label={starred ? 'Starred (click to remove)' : 'Star'} onClick={onToggleStar}><StarIcon /></MarkButton>}
    {onRate && <span className="photo-rating" role="group" aria-label="Rating">
      {RATINGS.map(r => <MarkButton key={r.value} kind={r.value} on={rating === r.value} label={rating === r.value ? `${r.label} (click to clear)` : r.label} onClick={() => onRate(rating === r.value ? null : r.value)}><RatingIcon rating={r.value} /></MarkButton>)}
    </span>}
  </span>;
}

/** The same buttons, used to choose which photos to show. Each button turns its filter on or off. */
export function PhotoMarkFilters({ starred, reference, ratings, onChange }: {
  starred: boolean; reference: boolean; ratings: RatingChoice[];
  onChange: (next: { starred: boolean; reference: boolean; ratings: RatingChoice[] }) => void;
}) {
  const current = { starred, reference, ratings };
  const toggleRating = (choice: RatingChoice) => onChange({ ...current, ratings: ratings.includes(choice) ? ratings.filter(r => r !== choice) : [...ratings, choice] });
  return <span className="photo-marks photo-mark-filters" role="group" aria-label="Show Only">
    <MarkButton kind="reference" on={reference} label={reference ? 'Showing Only Reference Photos' : 'Show Only Reference Photos'} onClick={() => onChange({ ...current, reference: !reference })}><ReferenceIcon /></MarkButton>
    <MarkButton kind="star" on={starred} label={starred ? 'Showing Only Starred Photos' : 'Show Only Starred Photos'} onClick={() => onChange({ ...current, starred: !starred })}><StarIcon /></MarkButton>
    <span className="photo-rating" role="group" aria-label="Ratings to Show">
      {RATINGS.map(r => <MarkButton key={r.value} kind={r.value} on={ratings.includes(r.value)} label={`${ratings.includes(r.value) ? 'Showing' : 'Show'} ${r.label} Photos`} onClick={() => toggleRating(r.value)}><RatingIcon rating={r.value} /></MarkButton>)}
      <MarkButton kind="unrated" on={ratings.includes('unrated')} label={`${ratings.includes('unrated') ? 'Showing' : 'Show'} Photos Not Rated Yet`} onClick={() => toggleRating('unrated')}><UnratedIcon /></MarkButton>
    </span>
  </span>;
}

function MarkButton({ kind, on, disabled, label, onClick, children }: { kind: string; on: boolean; disabled?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`photo-mark is-${kind}${on ? ' is-on' : ''}`} disabled={disabled} aria-pressed={on} aria-label={label} title={label} onClick={e => { e.stopPropagation(); onClick(); }}>{children}</button>;
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function StarIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.93 5.94 6.56.95-4.74 4.62 1.12 6.53L12 17.45l-5.87 3.09 1.12-6.53L2.51 9.39l6.56-.95L12 2.5z" {...stroke} fill="var(--mark-fill, none)" /></svg>;
}

/** A portrait card: a photo of you, kept to show the AI your likeness. */
function ReferenceIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="2.5" width="17" height="19" rx="3" {...stroke} fill="var(--mark-fill, none)" />
    <circle cx="12" cy="10" r="3.2" {...stroke} />
    <path d="M6.5 18.5c1-2.6 3-3.9 5.5-3.9s4.5 1.3 5.5 3.9" {...stroke} />
  </svg>;
}

function RatingIcon({ rating }: { rating: Rating }) {
  if (rating === 'meh') return <MehIcon />;
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={rating === 'disliked' ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="M7 10v12" {...stroke} />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" {...stroke} fill="var(--mark-fill, none)" />
  </svg>;
}

/** A flat hand held sideways, the "so-so" gesture between the two thumbs. */
function MehIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
    <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" {...stroke} />
    <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" {...stroke} />
    <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" {...stroke} />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" {...stroke} fill="var(--mark-fill, none)" />
  </svg>;
}

/** A dashed circle: no rating given yet. Only in the filters. */
function UnratedIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" {...stroke} strokeDasharray="3 3" fill="var(--mark-fill, none)" /></svg>;
}
