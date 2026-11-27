import { AttributeFilterPicker, CategoryPicker, type AttributeSelection } from './CategoryPicker';
import type { ExpressionCategory } from './api';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from '../../server/expression-attribute-vocabulary';

export type PhotoFilters = { category: string; framing: AttributeSelection; pose: AttributeSelection; morphology: AttributeSelection };
export const emptyPhotoFilters: PhotoFilters = {
  category: '*',
  framing: { include: [], exclude: [] },
  pose: { include: [], exclude: [] },
  morphology: { include: [], exclude: [] },
};

export function selectedAttributes(filters: PhotoFilters): AttributeSelection {
  return {
    include: [...filters.framing.include, ...filters.pose.include, ...filters.morphology.include],
    exclude: [...filters.framing.exclude, ...filters.pose.exclude, ...filters.morphology.exclude],
  };
}

export function ExpressionPhotoFilters({ categories, filters, onChange }: { categories: ExpressionCategory[]; filters: PhotoFilters; onChange: (filters: PhotoFilters) => void }) {
  const categoryOptions = categories.filter(c => c.path).map(c => ({ value: c.path, label: c.path.split('/').join(' > ') }));
  const groups = [
    ['Framing', FRAMING_TAGS, 'framing'],
    ['Pose', POSE_TAGS, 'pose'],
    ['Morphology', MORPHOLOGY_TAGS, 'morphology'],
  ] as const;
  return <>
    <div className="expression-filter-field">
      <CategoryPicker label="Photo Category" value={filters.category} onChange={category => onChange({ ...filters, category })} options={[{ value: '*', label: 'All Categories' }, ...categoryOptions]} searchPlaceholder="Search photo category…" emptyMessage="No matching options." />
    </div>
    {groups.map(([label, tags, field]) => <div className="expression-filter-field" key={field}>
      <AttributeFilterPicker label={label} value={filters[field]} onChange={value => onChange({ ...filters, [field]: value })} allLabel={`All ${label}`} options={tags.map(tag => ({ value: tag, label: tag.replace(/([a-z])([A-Z])/g, '$1 $2') }))} searchPlaceholder={`Search ${label.toLowerCase()}…`} />
    </div>)}
  </>;
}
