// Pure constants shared by server and browser screens (no Node imports).
export const VIDEO_LANGUAGES = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'en', label: 'English' },
] as const;

export const SHORTS_PLAYLIST = 'PLRugoq-5oewtiiVZSSnHvjxENllCrjCmr';

export interface YoutubePlaylist {
  id: string;
  title: string;
}
