/**
 * A dropdown for a packaging field with a fixed set of answers (see fieldChoices). An empty field shows "Choose…";
 * a value that isn't one of the answers is kept and marked, so nothing in the file is hidden or changed by opening it.
 * "no" and "No" count as the same answer.
 */
export function ChoiceField({ label, value, choices, disabled, onChange }: { label: string; value: string; choices: { value: string; label: string }[]; disabled?: boolean; onChange: (value: string) => void }) {
  const current = value.trim();
  const match = choices.find((c) => c.value.toLowerCase() === current.toLowerCase());
  return (
    <select className="field-choice" aria-label={label} value={match?.value ?? current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!current && <option value="">Choose…</option>}
      {current && !match && <option value={current}>{current} (not one of the choices)</option>}
      {choices.map((c) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  );
}
