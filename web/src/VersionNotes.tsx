import { useEffect, useState } from 'react';
import { getText, postJson, type PackagingVersion } from './api';

// The Notes box under a card's packaging versions: John's own notes about that version (what it tried, where it came
// from), kept in Notes.md inside the version folder. Shown as plain text; Edit turns it into a box to type in.
export function VersionNotes({ version, locked = false }: { version: PackagingVersion; locked?: boolean }) {
  // What the file says now: "" when the version has no Notes.md yet. null while loading.
  const [saved, setSaved] = useState<string | null>(version.notes ? null : '');
  const [draft, setDraft] = useState<{ text: string; was: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const notesPath = version.notes?.path;
  const notesModified = version.notes?.modified;
  useEffect(() => {
    if (!notesPath) return;
    let current = true;
    getText('projects', notesPath).then(
      (t) => { if (current) setSaved(t.replace(/^﻿/, '')); },
      (e: Error) => { if (current) setError(e.message); },
    );
    return () => { current = false; };
  }, [notesPath, notesModified]);

  if (saved === null) return error ? <p className="error">{error}</p> : null;

  const save = () => {
    if (draft === null || locked) return;
    setSaving(true);
    setError(null);
    postJson('/api/packaging/notes', { version: version.path, ...draft })
      .then(() => {
        setSaved(draft.text);
        setDraft(null);
      }, (e: Error) => setError(e.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="version-notes">
      <div className="version-notes-head">
        <h4>Notes</h4>
        {draft === null && (
          <button className="small" disabled={locked} onClick={() => setDraft({ text: saved, was: saved })}>
            {saved.trim() ? 'Edit' : 'Add Notes'}
          </button>
        )}
      </div>
      {draft === null ? (
        saved.trim() ? <p className="version-notes-text">{saved.trim()}</p> : <p className="muted small-text">No notes for this version.</p>
      ) : (
        <>
          <textarea rows={4} disabled={locked} value={draft.text} autoFocus onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="What this version tried, where it came from…" />
          <div className="claude-buttons">
            <button className="small" disabled={locked || saving || draft.text === draft.was} onClick={save}>
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
