const pending = new Set<symbol>();

/** Tracks in-memory drafts so navigating to another project can warn before unmounting them. */
export function setPendingPackaging(id: symbol, dirty: boolean) {
  if (dirty) pending.add(id); else pending.delete(id);
}

export function hasPendingPackaging() { return pending.size > 0; }
