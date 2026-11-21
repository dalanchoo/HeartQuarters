import { CategoryPicker } from './CategoryPicker';
import type { ExpressionCategory } from './api';
import { RATING_FILTER_OPTIONS, type RatingFilter } from './expressionRating';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from '../../server/expression-attribute-vocabulary';

export type PhotoFilters = { category: string; framing: string; pose: string; morphology: string; categoryText: string; framingText: string; poseText: string; morphologyText: string; rating: RatingFilter };
export const emptyPhotoFilters: PhotoFilters = { category: '*', framing: '', pose: '', morphology: '', categoryText: '', framingText: '', poseText: '', morphologyText: '', rating: '' };

export function ExpressionPhotoFilters({ categories, filters, onChange }: { categories: ExpressionCategory[]; filters: PhotoFilters; onChange: (filters: PhotoFilters) => void }) {
  const update = (key: Exclude<keyof PhotoFilters, 'rating'>, value: string) => onChange({ ...filters, [key]: value });
  const fields = [
    { label: 'Photo Category', field: 'category', text: 'categoryText', all: 'All Categories', options: categories.filter(c => c.path).map(c => ({ value: c.path, label: c.path.split('/').join(' > ') })) },
    ...([['Framing', FRAMING_TAGS, 'framing', 'framingText'], ['Pose', POSE_TAGS, 'pose', 'poseText'], ['Morphology', MORPHOLOGY_TAGS, 'morphology', 'morphologyText']] as const).map(([label, tags, field, text]) => ({ label, field, text, all: `All ${label}`, options: tags.map(tag => ({ value: tag, label: tag.replace(/([a-z])([A-Z])/g, '$1 $2') })) })),
  ] as const;
  return <>{fields.map(({ label, field, text, all, options }) => <div className="expression-filter-field" key={field}>
    <CategoryPicker label={label} value={filters[field]} onChange={value => update(field, value)} options={[{ value: field === 'category' ? '*' : '', label: all }, ...options]} searchPlaceholder={`Search ${label.toLowerCase()}…`} emptyMessage="No matching options." />
    <label>Filter <input type="search" aria-label={`Filter ${label}`} value={filters[text]} onChange={e => update(text, e.target.value)} /></label>
  </div>)}
    <label>Rating <select value={filters.rating} onChange={e => onChange({ ...filters, rating: e.target.value as RatingFilter })}>{RATING_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
  </>;
}
