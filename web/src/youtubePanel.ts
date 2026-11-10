import type { UploadJob } from '../../server/youtube';

/** A recorded upload wins over trying to connect the long-form's saved link. */
export function existingYoutubeJob(jobs: UploadJob[]): UploadJob | undefined {
  return jobs.find((job) => job.status === 'uploading' || (job.status === 'done' && !!job.videoId));
}

export function shouldLinkLongform(jobs: UploadJob[], connected: boolean, project?: string): boolean {
  return !existingYoutubeJob(jobs) && connected && !!project;
}
