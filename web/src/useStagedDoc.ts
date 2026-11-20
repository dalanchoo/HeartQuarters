import { useEffect, useRef, useState } from 'react';
import type { LoadedDoc } from './PackagingDoc';
import { parseFields } from './packaging';
import { applyStagedText, changedPackagingFields, clashingFields } from './stagedPackaging';

/** Keep changes in memory until Apply; the disk save still checks the original file for conflicts. */
export function useStagedDoc(original: LoadedDoc) {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const baseline = useRef<string | null>(null);
  const path = original.file.path;
  useEffect(() => { draftRef.current = null; baseline.current = null; setDraft(null); }, [path]);
  const discard = () => { draftRef.current = null; baseline.current = null; setDraft(null); };
  const pending = draft !== null && baseline.current !== null && draft !== baseline.current;
  const changes = pending ? changedPackagingFields(baseline.current!, draft!) : [];
  // Fields you're editing that were also changed on disk since (the file is re-read now and then). Shown straight away,
  // so you know before Apply that these can't be merged.
  const clashes = pending && original.text !== null ? clashingFields(original.text, baseline.current!, draft!) : [];
  const doc: LoadedDoc = {
    ...original,
    text: draft ?? original.text,
    fields: draft !== null ? parseFields(draft) : original.fields,
    save: async change => {
      if (original.locked) throw new Error('Unlock this version to change it.');
      const current = draftRef.current ?? original.text;
      if (current === null) throw new Error('The file is still loading.');
      if (baseline.current === null) baseline.current = original.text;
      const next = change(current);
      draftRef.current = next;
      setDraft(next);
    },
  };
  const apply = async (change?: (text: string) => string, expected?: string) => {
    const was = baseline.current ?? expected ?? original.text;
    if (was === null) throw new Error('The file is still loading.');
    const value = change ? change(draftRef.current ?? was) : draftRef.current;
    if (value === null || value === was) return;
    await original.save(current => applyStagedText(current, was, value));
    discard();
  };
  return { doc, pending, changes, clashes, apply, discard };
}
