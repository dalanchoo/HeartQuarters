import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterCategoryOptions, nextCategoryIndex, type CategoryOption } from './expressionPlanning';

export type AttributeSelection = { include: string[]; exclude: string[] };

function usePickerPopup(onClose?: () => void) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 0, width: 250, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 8, above = rect.top - 8;
      const useBelow = below >= 240 || below >= above;
      const maxHeight = Math.max(80, Math.min(320, useBelow ? below : above));
      setPosition(useBelow ? { left, top: rect.bottom + 4, width, maxHeight } : { left, bottom: window.innerHeight - rect.top + 4, width, maxHeight });
    };
    place(); search.current?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); onClose?.(); };
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popup.current?.contains(target)) close(); };
    const focusOutside = (event: FocusEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popup.current?.contains(target)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open, onClose]);
  return { open, setOpen, position, trigger, popup, search };
}

/** A single category control with its search at the top of the open menu. */
export function CategoryPicker({ label, value, options, onChange, disabled = false, placeholder = 'Choose a category…', searchPlaceholder = 'Search categories…', emptyMessage = 'No matching categories.' }: {
  label: string; value: string; options: CategoryOption[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string; searchPlaceholder?: string; emptyMessage?: string;
}) {
  const [query, setQuery] = useState(''); const [active, setActive] = useState(-1);
  const { open, setOpen, position, trigger, popup, search } = usePickerPopup();
  const id = useId(); const filtered = filterCategoryOptions(options, query);
  const selected = options.find(option => option.value === value);
  const choose = (option: CategoryOption) => { if (option.disabled) return; onChange(option.value); setOpen(false); trigger.current?.focus(); };
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, id, open]);
  return <div className="category-picker"><span className="category-picker-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className="category-picker-trigger" title={selected?.label ?? placeholder} disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => { if (!open) { setQuery(''); setActive(nextCategoryIndex(options, -1, 1)); } setOpen(!open); }}>
      <span id={`${id}-value`}>{selected?.label ?? placeholder}</span><span aria-hidden="true">▾</span>
    </button>
    {open && createPortal(<div ref={popup} className="category-picker-popup" style={position} onClick={e => e.stopPropagation()}>
      <input ref={search} type="search" role="combobox" aria-label={`Search ${label}`} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined} placeholder={searchPlaceholder} value={query} onChange={e => { setQuery(e.target.value); setActive(nextCategoryIndex(filterCategoryOptions(options, e.target.value), -1, 1)); }} onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => nextCategoryIndex(filtered, i, 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => nextCategoryIndex(filtered, i, -1)); }
        else if (e.key === 'Enter' && filtered[active]) { e.preventDefault(); choose(filtered[active]); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      }} />
      <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="category-picker-options">{filtered.length ? filtered.map((option, i) => <div id={`${id}-option-${i}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} className={i === active ? 'active' : ''} key={option.value} onMouseEnter={() => { if (!option.disabled) setActive(i); }} onMouseDown={e => e.preventDefault()} onClick={() => choose(option)}>{option.label}</div>) : <p className="muted">{emptyMessage}</p>}</div>
    </div>, document.body)}
  </div>;
}

/** Multi-select attribute filter with include and "Not" exclude toggles. */
export function AttributeFilterPicker({ label, value, options, onChange, allLabel, searchPlaceholder, emptyMessage = 'No matching options.', disabled = false }: {
  label: string; value: AttributeSelection; options: CategoryOption[]; onChange: (value: AttributeSelection) => void; allLabel: string; searchPlaceholder: string; emptyMessage?: string; disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const { open, setOpen, position, trigger, popup, search } = usePickerPopup();
  const id = useId(); const filtered = filterCategoryOptions(options, query);
  const labels = new Map(options.map(option => [option.value, option.label]));
  const summaryParts = [...value.include.map(tag => labels.get(tag) ?? tag), ...value.exclude.map(tag => `Not ${labels.get(tag) ?? tag}`)];
  const hasSelection = summaryParts.length > 0;
  const summary = hasSelection ? summaryParts.join(', ') : allLabel;
  const toggleInclude = (tag: string) => onChange({
    include: value.include.includes(tag) ? value.include.filter(item => item !== tag) : [...value.include, tag],
    exclude: value.exclude.filter(item => item !== tag),
  });
  const toggleExclude = (tag: string) => onChange({
    include: value.include.filter(item => item !== tag),
    exclude: value.exclude.includes(tag) ? value.exclude.filter(item => item !== tag) : [...value.exclude, tag],
  });
  return <div className="category-picker"><span className="category-picker-label" id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className={`category-picker-trigger${hasSelection ? ' active' : ''}`} title={summary} disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) setQuery(''); setOpen(!open); }}>
      <span id={`${id}-value`}>{summary}</span><span aria-hidden="true">▾</span>
    </button>
    {open && createPortal(<div ref={popup} className="category-picker-popup" role="dialog" aria-labelledby={`${id}-label`} style={position} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
      <div className="attribute-filter-search"><input ref={search} type="search" aria-label={`Search ${label}`} placeholder={searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} /><button type="button" className="small" disabled={!hasSelection} onClick={() => onChange({ include: [], exclude: [] })}>Clear</button></div>
      <div className="category-picker-options">{filtered.length ? filtered.map(option => {
        const included = value.include.includes(option.value);
        const excluded = value.exclude.includes(option.value);
        return <div className="attribute-filter-option" key={option.value}>
          <button type="button" className={`attribute-filter-include${included ? ' active' : ''}`} aria-pressed={included} onClick={() => toggleInclude(option.value)}>{option.label}</button>
          <button type="button" className={`small attribute-filter-not${excluded ? ' active' : ''}`} aria-pressed={excluded} aria-label={`Not ${option.label}`} onClick={() => toggleExclude(option.value)}>Not</button>
        </div>;
      }) : <p className="muted">{emptyMessage}</p>}</div>
    </div>, document.body)}
  </div>;
}
