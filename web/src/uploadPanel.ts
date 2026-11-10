/** Remember which video's upload panel was open, without storing its contents. */
export function uploadPanelOpen(storage: Pick<Storage, 'getItem'>, piece: string): boolean {
  try { return storage.getItem(`hq-youtube-open:${piece}`) === 'true'; } catch { return false; }
}

export function rememberUploadPanel(storage: Pick<Storage, 'setItem'>, piece: string, open: boolean): void {
  try { storage.setItem(`hq-youtube-open:${piece}`, String(open)); } catch { /* The panel still works if browser storage is unavailable. */ }
}
