// Outside Demand, step 1: search all of YouTube for a research topic and save what other channels made.
// Settings: Video Projects\_HeartQuarters\Research\Outside\<topic>\Scan Settings.json
// Each scan: ...\Outside\<topic>\<YYYY-MM-DD HHmm>\YouTube Videos.json (older scans are kept for comparison).
import fs from 'node:fs';
import path from 'node:path';
import { checkTopic, topicLabel, type ResearchTopic } from './channel-research.js';
import { parseDuration, readChannelVideos } from './channel-videos.js';
import { safeResolve } from './config.js';
import { makeFolder, readable, readText, writable, writeFile } from './safe-files.js';
import { youtubeAccessToken } from './youtube-auth.js';
import { QUOTA_USED_UP, youtubeFetch, youtubeQuota } from './youtube-quota.js';

export const OUTSIDE_DIR = '_HeartQuarters/Research/Outside';
export const SETTINGS_FILE = 'Scan Settings.json';
export const VIDEOS_FILE = 'YouTube Videos.json';
const SEARCH_WORDS_MAX = 8;
const SEARCH_WORD_LENGTH_MAX = 100;
const RESULTS_PER_SEARCH = 50;
const RECENT_DAYS = 90;
/** YouTube Shorts can be up to three minutes long; longer videos count as longform. */
const SHORT_MAX_SECONDS = 180;
const SEARCH_COST = 100;
const MUST_MENTION_MAX = 20;
const DESCRIPTION_MAX = 5_000;
const TAGS_MAX = 40;

export type ScanFormat = 'longform' | 'short' | 'both';
export type ScanReach = 'english' | 'worldwide';

export interface ScanSettings {
  version: 1;
  /** What to type into YouTube search, one search each. */
  searchWords: string[];
  format: ScanFormat;
  /** English-language results only, or the whole world (other languages are translated in the report). */
  reach: ScanReach;
  /** Also ask vidIQ (uses vidIQ credits). Used by a later step. */
  vidiq: boolean;
  /**
   * A video is kept only if its title, description or tags mention at least one of these, as a whole word
   * (so "SDAM" doesn't match "ADAM" or "Saddam"). Empty keeps everything. Applied when reading a scan,
   * so changing the words re-filters saved scans without searching again.
   */
  mustMention: string[];
}

export type SearchOrder = 'viewCount' | 'date';

export interface OutsideVideo {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  seconds: number;
  /** Guessed from length: three minutes or less counts as a Short. */
  kind: 'longform' | 'short';
  language?: string;
  /** The video's tags (older scans don't have them). */
  tags?: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Which searches found it, for example "SDAM (Most Viewed)". */
  foundBy: string[];
}

export interface OutsideScan {
  version: 1;
  topic: ResearchTopic;
  scannedAt: string;
  settings: ScanSettings;
  searches: { word: string; order: SearchOrder; found: number }[];
  videos: OutsideVideo[];
  unitsUsed: number;
}

/** A scanned video as the screen sees it: which Must Mention words it contains, and whether it is kept. */
export interface FilteredVideo extends OutsideVideo {
  mentions: string[];
  kept: boolean;
}

export interface FilteredScan extends Omit<OutsideScan, 'videos'> {
  videos: FilteredVideo[];
  kept: number;
  removed: number;
}

export interface OutsideOverview {
  settings: ScanSettings;
  estimate: number;
  quotaLeft: number;
  latest: FilteredScan | null;
  scans: string[];
}

type FetchFn = typeof youtubeFetch;
const activeScans = new Set<string>();

export function defaultSettings(topic: ResearchTopic): ScanSettings {
  return { version: 1, searchWords: [topicLabel(topic)], format: 'both', reach: 'english', vidiq: false, mustMention: [] };
}

/** Trims a list of words or phrases, dropping blanks and repeats (ignoring case). */
function tidyWords(raw: unknown[], what: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of raw) {
    if (typeof word !== 'string') throw new Error(`${what} must be text.`);
    const clean = word.replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    if (clean.length > SEARCH_WORD_LENGTH_MAX) throw new Error(`One of the ${what.toLowerCase()} is too long.`);
    seen.add(clean.toLowerCase());
    words.push(clean);
  }
  return words;
}

/** Checks settings sent from the screen and tidies the word lists (trimmed, no blanks or repeats). */
export function checkSettings(raw: unknown): ScanSettings {
  const given = raw as Partial<ScanSettings> | null;
  if (!given || !Array.isArray(given.searchWords)) throw new Error('Add at least one search word.');
  const searchWords = tidyWords(given.searchWords, 'Search Words');
  if (!searchWords.length) throw new Error('Add at least one search word.');
  if (searchWords.length > SEARCH_WORDS_MAX) throw new Error(`Use at most ${SEARCH_WORDS_MAX} search words.`);
  if (!['longform', 'short', 'both'].includes(given.format as string)) throw new Error('Choose Longform, Shorts, or Both.');
  if (!['english', 'worldwide'].includes(given.reach as string)) throw new Error('Choose English or Worldwide.');
  // Settings saved before Must Mention existed have no list; that means "keep everything".
  if (given.mustMention !== undefined && !Array.isArray(given.mustMention)) throw new Error('Must Mention words must be a list.');
  const mustMention = tidyWords(given.mustMention ?? [], 'Must Mention Words');
  if (mustMention.length > MUST_MENTION_MAX) throw new Error(`Use at most ${MUST_MENTION_MAX} Must Mention words.`);
  return { version: 1, searchWords, format: given.format as ScanFormat, reach: given.reach as ScanReach, vidiq: given.vidiq === true, mustMention };
}

/** Matches a word or phrase on its own: not inside a longer word, any capitals, any spacing between phrase words. */
function wholeWord(word: string): RegExp {
  const pattern = word.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Which Must Mention words a video's title, description or tags contain. */
export function videoMentions(video: Pick<OutsideVideo, 'title' | 'description' | 'tags'>, words: string[]): string[] {
  const text = [video.title, video.description, ...(video.tags ?? [])].join('\n');
  return words.filter((word) => wholeWord(word).test(text));
}

/** Marks each video kept or removed by the Must Mention words. */
export function filterScan(scan: OutsideScan, words: string[]): FilteredScan {
  const videos = scan.videos.map((video) => {
    const mentions = videoMentions(video, words);
    return { ...video, mentions, kept: words.length === 0 || mentions.length > 0 };
  });
  const kept = videos.filter((v) => v.kept).length;
  return { ...scan, videos, kept, removed: videos.length - kept };
}

/** YouTube units a scan will use: two searches per word, plus about one unit per 50 videos for their numbers. */
export function scanEstimate(settings: ScanSettings): number {
  const searches = settings.searchWords.length * 2;
  return searches * SEARCH_COST + Math.ceil((searches * RESULTS_PER_SEARCH) / 50);
}

function topicFolder(topic: ResearchTopic): string {
  return safeResolve('projects', `${OUTSIDE_DIR}/${topic}`);
}

export function readScanSettings(rawTopic: unknown): ScanSettings {
  const topic = checkTopic(rawTopic);
  const file = path.join(topicFolder(topic), SETTINGS_FILE);
  if (!fs.existsSync(file)) return defaultSettings(topic);
  try {
    return checkSettings(JSON.parse(readText(readable(file)).replace(/^﻿/, '')));
  } catch {
    throw new Error('The scan settings file could not be read. Nothing was changed.');
  }
}

export function saveScanSettings(rawTopic: unknown, raw: unknown): ScanSettings {
  const topic = checkTopic(rawTopic);
  const settings = checkSettings(raw);
  const dir = topicFolder(topic);
  makeFolder(dir);
  writable(dir);
  writeFile(writable(path.join(dir, SETTINGS_FILE)), JSON.stringify(settings, null, 2) + '\n');
  return settings;
}

const SCAN_FOLDER_RE = /^\d{4}-\d{2}-\d{2} \d{4}$/;

/** Saved scan folders for a topic, newest first. */
export function listScans(topic: ResearchTopic): string[] {
  const dir = topicFolder(topic);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return fs.readdirSync(readable(dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && SCAN_FOLDER_RE.test(e.name) && fs.existsSync(path.join(dir, e.name, VIDEOS_FILE)))
    .map((e) => e.name)
    .sort()
    .reverse();
}

export function readScan(topic: ResearchTopic, folder: string): OutsideScan {
  if (!SCAN_FOLDER_RE.test(folder)) throw new Error('Choose a saved scan.');
  const file = safeResolve('projects', `${OUTSIDE_DIR}/${topic}/${folder}/${VIDEOS_FILE}`);
  try {
    const parsed = JSON.parse(readText(readable(file)).replace(/^﻿/, '')) as OutsideScan;
    if (parsed?.version !== 1 || !Array.isArray(parsed.videos)) throw new Error('format');
    return parsed;
  } catch {
    throw new Error(`The scan from ${folder} could not be read.`);
  }
}

export function outsideOverview(rawTopic: unknown): OutsideOverview {
  const topic = checkTopic(rawTopic);
  const settings = readScanSettings(topic);
  const scans = listScans(topic);
  const quota = youtubeQuota();
  const latest = scans[0] ? filterScan(readScan(topic, scans[0]), settings.mustMention) : null;
  return { settings, estimate: scanEstimate(settings), quotaLeft: quota.limit - quota.used, latest, scans };
}

/** "2026-11-25 1430" in local time, used as the scan's folder name. */
export function scanFolderName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}`;
}

async function youtubeJson<T>(url: string, token: string, fetcher: FetchFn, what: string): Promise<T> {
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (/quotaExceeded|dailyLimitExceeded/.test(body)) throw new Error(QUOTA_USED_UP);
    throw new Error(`YouTube returned ${res.status} when ${what}.`);
  }
  return (await res.json()) as T;
}

interface RawSearch { items?: { id?: { videoId?: string } }[] }
interface RawVideo {
  id?: string;
  snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string; defaultAudioLanguage?: string; defaultLanguage?: string; tags?: string[] };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}

const count = (value?: string) => (value === undefined ? null : Number(value));
const ORDER_LABEL: Record<SearchOrder, string> = { viewCount: 'Most Viewed', date: `Newest, Last ${RECENT_DAYS} Days` };

/** Runs the YouTube searches for a topic, looks up each video's numbers and length, and saves the result to Drive. */
export async function runYoutubeScan(
  rawTopic: unknown,
  deps: { token?: string; fetcher?: FetchFn; now?: Date; ownChannelId?: string | null } = {},
): Promise<OutsideScan> {
  const topic = checkTopic(rawTopic);
  const settings = readScanSettings(topic);
  const fetcher = deps.fetcher ?? youtubeFetch;
  const now = deps.now ?? new Date();
  const estimate = scanEstimate(settings);
  if (!deps.fetcher) {
    const quota = youtubeQuota();
    if (quota.limit - quota.used < estimate) throw new Error(`This scan needs about ${estimate} YouTube units and only ${quota.limit - quota.used} are left today.`);
  }
  if (activeScans.has(topic)) throw new Error('A scan for this topic is already running.');
  activeScans.add(topic);
  try {
    const token = deps.token ?? await youtubeAccessToken();
    const ownChannelId = deps.ownChannelId === undefined ? readChannelVideos()?.channel.id ?? null : deps.ownChannelId;
    const foundBy = new Map<string, string[]>();
    const searches: OutsideScan['searches'] = [];
    const recentAfter = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
    let unitsUsed = 0;

    for (const word of settings.searchWords) {
      for (const order of ['viewCount', 'date'] as const) {
        const params = new URLSearchParams({ part: 'id', type: 'video', q: word, order, maxResults: String(RESULTS_PER_SEARCH), safeSearch: 'none' });
        if (order === 'date') params.set('publishedAfter', recentAfter);
        if (settings.reach === 'english') params.set('relevanceLanguage', 'en');
        // YouTube search can't filter by "Short" (its length filters are under 4, 4-20 and over 20 minutes),
        // so every length is searched and the exact length is checked below.
        const data = await youtubeJson<RawSearch>(`https://www.googleapis.com/youtube/v3/search?${params}`, token, fetcher, 'searching');
        unitsUsed += SEARCH_COST;
        const ids = (data.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => !!id);
        searches.push({ word, order, found: ids.length });
        for (const id of ids) foundBy.set(id, [...(foundBy.get(id) ?? []), `${word} (${ORDER_LABEL[order]})`]);
      }
    }

    const videos: OutsideVideo[] = [];
    const ids = [...foundBy.keys()];
    for (let i = 0; i < ids.length; i += 50) {
      const params = new URLSearchParams({ part: 'snippet,contentDetails,statistics', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
      const data = await youtubeJson<{ items?: RawVideo[] }>(`https://www.googleapis.com/youtube/v3/videos?${params}`, token, fetcher, 'reading video details');
      unitsUsed += 1;
      for (const item of data.items ?? []) {
        if (!item.id || !item.snippet) continue;
        if (ownChannelId && item.snippet.channelId === ownChannelId) continue;
        const seconds = parseDuration(item.contentDetails?.duration ?? '');
        const kind = seconds > 0 && seconds <= SHORT_MAX_SECONDS ? 'short' : 'longform';
        if (settings.format !== 'both' && kind !== settings.format) continue;
        videos.push({
          id: item.id,
          title: item.snippet.title ?? '',
          description: (item.snippet.description ?? '').slice(0, DESCRIPTION_MAX),
          channelId: item.snippet.channelId ?? '',
          channelTitle: item.snippet.channelTitle ?? '',
          publishedAt: item.snippet.publishedAt ?? '',
          seconds,
          kind,
          language: item.snippet.defaultAudioLanguage ?? item.snippet.defaultLanguage,
          tags: (item.snippet.tags ?? []).slice(0, TAGS_MAX),
          views: count(item.statistics?.viewCount),
          likes: count(item.statistics?.likeCount),
          comments: count(item.statistics?.commentCount),
          foundBy: foundBy.get(item.id) ?? [],
        });
      }
    }
    videos.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

    const scan: OutsideScan = { version: 1, topic, scannedAt: now.toISOString(), settings, searches, videos, unitsUsed };
    const dir = safeResolve('projects', `${OUTSIDE_DIR}/${topic}/${scanFolderName(now)}`);
    makeFolder(dir);
    writable(dir);
    writeFile(writable(path.join(dir, VIDEOS_FILE)), JSON.stringify(scan, null, 2) + '\n');
    return scan;
  } finally {
    activeScans.delete(topic);
  }
}
