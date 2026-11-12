import { useEffect, useState } from 'react';
import { getText, postJson, type PackagingVersion } from './api';

// The Notes box under a card's packaging versions: John's own notes about that version (what it tried, where it came
// from), kept in Notes.md inside the version folder. Shown as plain text; Edit turns it into a box to type in.
export function VersionNotes({ version }: { version: PackagingVersion }) {
  // What the file says now: "" when the version has no Notes.md yet. null while loading.
  const [saved, setSaved] = useState<string | null>(version.notes ? null : '');
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (version.notes) getText('projects', version.notes.path).then((t) => setSaved(t.replace(/^﻿/, '')), (e: Error) => setError(e.message));
  }, [version.notes?.path]);

  if (saved === null) return error ? <p className="error">{error}</p> : null;

  const save = () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    postJson('/api/packaging/notes', { version: version.path, text: draft, was: saved })
      .then(() => {
        setSaved(draft);
        setDraft(null);
      }, (e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="version-notes">
      <div className="version-notes-head">
        <h4>Notes</h4>
        {draft === null && (
          <button className="small" onClick={() => setDraft(saved)}>
            {saved.trim() ? 'Edit' : 'Add notes'}
          </button>
        )}
      </div>
      {draft === null ? (
        saved.trim() ? <p className="version-notes-text">{saved.trim()}</p> : <p className="muted small-text">No notes for this version.</p>
      ) : (
        <>
          <textarea rows={4} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} placeholder="What this version tried, where it came from…" />
          <div className="claude-buttons">
            <button className="small" disabled={saving || draft === saved} onClick={save}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="small" disabled={saving} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
