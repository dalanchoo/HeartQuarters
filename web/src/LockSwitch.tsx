/**
 * The selected version's Lock/Unlock switch: red with a closed padlock while locked, green with an open one while
 * unlocked (John's reference picture, 2026-11-17). Only the selected version has one; every other version is a record.
 */
export function LockSwitch({ locked, name, onToggle }: { locked: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!locked}
      className={`lock-switch ${locked ? 'lock-switch--locked' : 'lock-switch--unlocked'}`}
      title={locked ? `${name} is locked. Click to unlock it, so you can edit it or copy into it.` : `${name} is unlocked. Click to lock it again.`}
      onClick={onToggle}
    >
      <span className="lock-switch-knob" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14">
          {locked ? <path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" /> : <path d="M7 10V7a5 5 0 0 1 9.6-1.9" fill="none" stroke="currentColor" strokeWidth="2.4" />}
          <rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor" />
        </svg>
      </span>
      <span className="lock-switch-text">{locked ? 'Locked' : 'Unlocked'}</span>
    </button>
  );
}
