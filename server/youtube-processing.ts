/** The two supported Short layouts: a video's Shorts folder and the standalone Shorts group. */
export function isShortPiece(piece: string): boolean {
  const parts = piece.replace(/\\/g, '/').split('/').map((part) => part.toLowerCase());
  return parts.includes('shorts') || parts[0] === '999 - shorts';
}

export async function youtubeProcessingStatus(token: string, id: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=processingDetails&id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Could not check YouTube processing (${res.status}).`);
  const body = await res.json() as { items?: { processingDetails?: { processingStatus?: string } }[] };
  const status = body.items?.[0]?.processingDetails?.processingStatus;
  if (!status) throw new Error('YouTube did not report whether processing is finished.');
  return status;
}

/** A timeout leaves the video uploaded and tells the user to retry its thumbnail later. */
export async function waitForShortProcessing(check: () => Promise<string>, pause: () => Promise<void>, attempts = 120): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const status = await check();
    if (status === 'succeeded') return;
    if (status !== 'processing') throw new Error(`YouTube processing status is ${status}.`);
    if (i + 1 < attempts) await pause();
  }
  throw new Error('YouTube is still processing. Try the thumbnail again when processing has finished.');
}
