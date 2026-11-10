import type { UploadJob } from '../../server/youtube';

/** A recorded upload wins over trying to connect the long-form's saved link. */
export function existingYoutubeJob(jobs: UploadJob[], preferredId?: string | null): UploadJob | undefined {
  return jobs.find((job) => job.status === 'uploading')
    ?? jobs.find((job) => job.id === preferredId && job.status === 'done' && !!job.videoId)
    ?? jobs.find((job) => job.status === 'done' && !!job.videoId);
}

export function preferredYoutubeJob(storage: Pick<Storage, 'getItem'>, piece: string): string | null {
  try { return storage.getItem(`hq-youtube-video:${piece}`); } catch { return null; }
}

export function rememberYoutubeJob(storage: Pick<Storage, 'setItem'>, piece: string, id: string): void {
  try { storage.setItem(`hq-youtube-video:${piece}`, id); } catch { /* Linking still works for this session. */ }
}

export function youtubeVideoUrl(id: string, short: boolean): string {
  return short ? `https://youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

export function shouldLinkLongform(jobs: UploadJob[], connected: boolean, project?: string): boolean {
  return !existingYoutubeJob(jobs) && connected && !!project;
}
