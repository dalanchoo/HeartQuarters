import { useRef, type ReactNode } from 'react';
import { YOUTUBE_SELECTION as YOUTUBE } from './comparisonSelection';
import { YouTubeIcon } from './YouTubeOpenLink';

/**
 * A drop-down that can show pictures (a plain <select> can only show text). `label` is the spoken name of each choice;
 * `render` (optional) draws it, for example with the YouTube icon or a thumbnail preview.
 */
export function PackagingChoice({ name, value, options, label, onChange, render, className, disabled }: { name: string; value: string; options: string[]; label: (value: string) => string; onChange: (value: string) => void; render?: (value: string) => ReactNode; className?: string; disabled?: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const show = (choice: string) => render ? render(choice) : choice === YOUTUBE ? <YouTubeIcon /> : label(choice);
  return <details className={className ? `packaging-choice ${className}` : 'packaging-choice'} ref={menu} onToggle={() => { if (disabled && menu.current) menu.current.open = false; }} onKeyDown={event => {
    if (disabled) return;
    if (event.key === 'Escape') { menu.current!.open = false; menu.current!.querySelector('summary')?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); menu.current!.open = true;
      const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('.packaging-choice-menu button')];
      const at = buttons.indexOf(event.target as HTMLButtonElement);
      buttons[at < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
    <summary aria-label={`${name}: ${value === YOUTUBE && !render ? 'YouTube' : label(value)}`} aria-disabled={disabled || undefined}>{show(value)}</summary>
    <div className="packaging-choice-menu">
      {options.map(choice => <button key={choice} type="button" disabled={disabled} className={choice === value ? 'selected' : ''} aria-label={choice === YOUTUBE && !render ? 'YouTube' : render ? label(choice) : undefined} aria-current={choice === value ? 'true' : undefined} onClick={() => { onChange(choice); menu.current!.open = false; }}>{show(choice)}</button>)}
    </div>
  </details>;
}
