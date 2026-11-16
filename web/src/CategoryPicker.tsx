import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterCategoryOptions, nextCategoryIndex, type CategoryOption } from './expressionPlanning';

/** A single category control with its search at the top of the open menu. */
export function CategoryPicker({ label, value, options, onChange, disabled = false, placeholder = 'Choose a category…', searchPlaceholder = 'Search categories…', emptyMessage = 'No matching categories.' }: {
  label: string; value: string; options: CategoryOption[]; onChange: (value: string) => void; disabled?: boolean; placeholder?: string; searchPlaceholder?: string; emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number }>({ left: 0, width: 250, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null); const popup = useRef<HTMLDivElement>(null); const search = useRef<HTMLInputElement>(null);
  const id = useId(); const filtered = filterCategoryOptions(options, query);
  const selected = options.find(option => option.value === value);
  const choose = (option: CategoryOption) => { if (option.disabled) return; onChange(option.value); setOpen(false); trigger.current?.focus(); };
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
    const outside = (event: PointerEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setOpen(false); };
    const focusOutside = (event: FocusEvent) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popup.current?.contains(target)) setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
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
