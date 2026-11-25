// Topic research (Channel → Research), saved in Drive under Video Projects\_HeartQuarters\Research\<topic>.json.
// "Your Channel Evidence" gathers the downloaded comments and transcripts of every video John tagged with a topic,
// so an AI can point out unanswered questions, themes that resonate and gaps. Outside demand (Reddit, news, vidIQ)
// is kept separate and is not part of this evidence.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AI_NAMES, isAiId, type AiId } from './ai.js';
import { readAnalysisTranscript } from './analytics-context.js';
import type { AskAi } from './brief.js';
import { readVideoComments, type StoredCommentThread } from './channel-comments.js';
import { readChannelVideos, type ChannelVideo } from './channel-videos.js';
import { safeResolve } from './config.js';
import { askReadOnlyImage } from './expression-assessment.js';
import { makeFolder, readable, readText, writable, writeFile } from './safe-files.js';
import { TOPICS, type Topic } from './video-profile.js';

export const RESEARCH_DIR = '_HeartQuarters/Research';
export type ResearchTopic = Exclude<Topic, 'unassigned'>;
export const RESEARCH_TOPICS = TOPICS.filter((t): t is ResearchTopic => t !== 'unassigned');

const FOCUS_MAX = 2_000;
const REPORTS_KEPT = 20;
const COMMENT_TEXT_MAX = 2_000;
const THREADS_PER_VIDEO_MAX = 300;
const TRANSCRIPT_MAX = 40_000;

export interface EvidenceVideo {
  id: string;
  title: string;
  kind: ChannelVideo['kind'];
  publishedAt: string;
  /** Viewer comment threads (John's own top-level comments are left out). */
  comments: number;
  /** True when a transcript (or, failing that, the script) was found in the linked project. */
  transcript: boolean;
}

export interface TopicEvidence {
  topic: ResearchTopic;
  videos: EvidenceVideo[];
  commentCount: number;
  transcriptCount: number;
}

export interface TopicCount {
  topic: ResearchTopic;
  videos: number;
  comments: number;
}

export interface ResearchReport {
  id: string;
  ai: AiId;
  at: string;
  /** John's optional question for this run. */
  focus: string;
  videos: EvidenceVideo[];
  commentCount: number;
  transcriptCount: number;
  text: string;
}

export interface TopicResearch {
  version: 1;
  topic: ResearchTopic;
  reports: ResearchReport[];
}

const activeResearch = new Set<string>();

/** "SDAM" for sdam, "Psychedelics" for psychedelics. */
export function topicLabel(topic: ResearchTopic): string {
  return topic === 'sdam' ? 'SDAM' : topic.charAt(0).toUpperCase() + topic.slice(1);
}

export function checkTopic(topic: unknown): ResearchTopic {
  if (typeof topic !== 'string' || !RESEARCH_TOPICS.includes(topic as ResearchTopic)) {
    throw new Error('Choose a topic to research.');
  }
  return topic as ResearchTopic;
}

/** Videos whose main or second Topic is this topic, newest first. */
export function topicVideos(topic: ResearchTopic, videos: ChannelVideo[]): ChannelVideo[] {
  return videos
    .filter((v) => v.topic === topic || v.topic2 === topic)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function viewerThreads(videoId: string): StoredCommentThread[] {
  try {
    return (readVideoComments(videoId)?.threads ?? []).filter((t) => !t.isOwner);
  } catch {
    return [];
  }
}

/** How many videos and viewer comments each topic has, for the topic picker. */
export function topicCounts(videos: ChannelVideo[] = readChannelVideos()?.videos ?? []): TopicCount[] {
  return RESEARCH_TOPICS.map((topic) => {
    const list = topicVideos(topic, videos);
    return { topic, videos: list.length, comments: list.reduce((sum, v) => sum + viewerThreads(v.id).length, 0) };
  });
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function safeName(title: string): string {
  return title.replace(/[^\p{L}\p{N} _-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Video';
}

/** Writes one evidence file for a video: its numbers, viewer comments (with John's replies) and transcript. */
export function evidenceText(video: ChannelVideo, threads: StoredCommentThread[], transcript: { text: string; source: 'transcript' | 'script' } | null): string {
  const lines = [
    `# ${video.title}`,
    `Kind: ${video.kind === 'short' ? 'Short' : 'Longform'} | Published: ${video.publishedAt.slice(0, 10)} | YouTube ID: ${video.id}`,
  ];
  if (video.numbers) {
    lines.push(`Views: ${video.numbers.views} | Average viewed: ${Math.round(video.numbers.averageViewPercentage)}% | Likes: ${video.numbers.likes} | Subscribers gained: ${video.numbers.subscribersGained}`);
  }
  if (video.note.trim()) lines.push(`John's note: ${clip(video.note, 1_000)}`);
  lines.push('', `## Viewer Comments (${threads.length})`);
  if (!threads.length) lines.push('(No downloaded viewer comments.)');
  const sorted = [...threads].sort((a, b) => b.likeCount - a.likeCount || b.publishedAt.localeCompare(a.publishedAt));
  for (const thread of sorted.slice(0, THREADS_PER_VIDEO_MAX)) {
    lines.push(`- ${thread.author} (${thread.likeCount} likes, ${thread.publishedAt.slice(0, 10)}${thread.ownerReplied ? ', John replied' : ', no reply from John'}): ${clip(thread.text, COMMENT_TEXT_MAX)}`);
    for (const reply of thread.replies) {
      lines.push(`  - ${reply.isOwner ? 'John' : reply.author}: ${clip(reply.text, COMMENT_TEXT_MAX)}`);
    }
  }
  if (threads.length > THREADS_PER_VIDEO_MAX) lines.push(`(${threads.length - THREADS_PER_VIDEO_MAX} less-liked comments left out.)`);
  lines.push('', '## Transcript');
  if (!transcript) lines.push(video.piece ? '(No transcript or script found in the project.)' : '(Not linked to a project, so no transcript.)');
  else {
    if (transcript.source === 'script') lines.push('(This is the script, which may differ from what was said.)');
    lines.push(transcript.text.length > TRANSCRIPT_MAX ? `${transcript.text.slice(0, TRANSCRIPT_MAX)}\n(Transcript cut short.)` : transcript.text);
  }
  return lines.join('\n') + '\n';
}

async function transcriptFor(video: ChannelVideo) {
  if (!video.piece) return null;
  try {
    return await readAnalysisTranscript(video.piece);
  } catch {
    return null;
  }
}

/** Collects the channel's own evidence for a topic; with `work`, also writes one file per video there. */
export async function gatherTopicEvidence(
  rawTopic: unknown,
  work?: string,
  videos: ChannelVideo[] = readChannelVideos()?.videos ?? [],
): Promise<TopicEvidence> {
  const topic = checkTopic(rawTopic);
  const list = topicVideos(topic, videos);
  const evidence: EvidenceVideo[] = [];
  for (const [index, video] of list.entries()) {
    const threads = viewerThreads(video.id);
    const transcript = await transcriptFor(video);
    evidence.push({ id: video.id, title: video.title, kind: video.kind, publishedAt: video.publishedAt, comments: threads.length, transcript: !!transcript });
    if (work) {
      const name = `${String(index + 1).padStart(2, '0')} - ${safeName(video.title)}.md`;
      fs.writeFileSync(path.join(work, name), evidenceText(video, threads, transcript), { flag: 'wx' });
    }
  }
  return {
    topic,
    videos: evidence,
    commentCount: evidence.reduce((sum, v) => sum + v.comments, 0),
    transcriptCount: evidence.filter((v) => v.transcript).length,
  };
}

function researchFile(topic: ResearchTopic, forWrite: boolean): string {
  const dir = safeResolve('projects', RESEARCH_DIR);
  if (forWrite) {
    makeFolder(dir);
    writable(dir);
    return writable(path.join(dir, `${topic}.json`));
  }
  return path.join(dir, `${topic}.json`);
}

function validReport(r: unknown): r is ResearchReport {
  const item = r as ResearchReport;
  return !!item && typeof item.id === 'string' && isAiId(item.ai) && typeof item.at === 'string'
    && typeof item.text === 'string' && Array.isArray(item.videos);
}

/** Reads the saved reports for a topic, newest first; empty when none were made yet. */
export function readTopicResearch(rawTopic: unknown): TopicResearch {
  const topic = checkTopic(rawTopic);
  const file = researchFile(topic, false);
  if (!fs.existsSync(file)) return { version: 1, topic, reports: [] };
  let parsed: { version?: unknown; reports?: unknown };
  try {
    parsed = JSON.parse(readText(readable(file)).replace(/^﻿/, ''));
  } catch {
    throw new Error('The research file could not be read. Nothing was changed.');
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.reports) || !parsed.reports.every(validReport)) {
    throw new Error('The research file has an unexpected format. Nothing was changed.');
  }
  return { version: 1, topic, reports: parsed.reports.map((r) => ({ ...r, focus: typeof r.focus === 'string' ? r.focus : '' })) };
}

export function buildResearchPrompt(label: string, evidence: TopicEvidence, focus: string, ai: AiId): string {
  return [
    `You are ${AI_NAMES[ai]}, researching the topic “${label}” for John, who makes the YouTube channel Heart Mind Fusion.`,
    "John's voice is calm, honest, personal, and plain-spoken. Be specific and skip generic YouTube advice.",
    `Your working folder has one Markdown file for each of the ${evidence.videos.length} videos John tagged with this topic `
      + `(${evidence.commentCount} viewer comment threads, ${evidence.transcriptCount} transcripts). Read every file. `
      + 'Each has the video\'s numbers, viewer comments (and whether John replied) and what John said in the video.',
    'This is evidence from Heart Mind Fusion\'s own audience only. Do not present it as wider demand on YouTube or elsewhere; say so where it matters.',
    'Do not create, edit, or delete any files. Reply directly in Markdown with these sections:',
    [
      '## Unanswered Questions: what viewers ask that John has not answered, in a reply or in a video. Quote short comments and name the video.',
      '## What Resonates: themes, moments, and ideas viewers respond to most, with evidence.',
      '## Gaps Not Yet Covered: parts of this topic viewers bring up that no video covers yet, or covers only briefly.',
      '## Video Ideas: up to five concrete ideas (new video, follow-up, or remake), each tied to the evidence above.',
      '## Evidence Limits: how much evidence there is and what it cannot tell John.',
    ].join('\n'),
    focus ? `--- JOHN'S QUESTION FOR THIS RUN ---\n${focus}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Asks the chosen AI to study the topic's channel evidence and saves its report to Drive. */
export async function runTopicResearch(
  rawTopic: unknown,
  rawAi: unknown,
  rawFocus: unknown,
  ask: AskAi = askReadOnlyImage,
  videos?: ChannelVideo[],
): Promise<TopicResearch> {
  const topic = checkTopic(rawTopic);
  const label = topicLabel(topic);
  if (!isAiId(rawAi)) throw new Error('Choose Claude, ChatGPT, or Gemini.');
  if (rawFocus !== undefined && typeof rawFocus !== 'string') throw new Error('The question must be text.');
  const focus = (rawFocus ?? '').trim();
  if (focus.length > FOCUS_MAX) throw new Error('That question is too long.');
  if (activeResearch.has(topic)) throw new Error('Research on this topic is already running. Wait for it to finish.');
  activeResearch.add(topic);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-research-'));
  try {
    const evidence = await gatherTopicEvidence(topic, work, videos);
    if (!evidence.videos.length) throw new Error(`No videos are tagged ${label} yet. Set the Topic in About This Video first.`);
    const answer = (await ask(rawAi, buildResearchPrompt(label, evidence, focus, rawAi), work)).trim();
    if (!answer) throw new Error(`${AI_NAMES[rawAi]} returned an empty report.`);
    const current = readTopicResearch(topic);
    const report: ResearchReport = {
      id: randomUUID(), ai: rawAi, at: new Date().toISOString(), focus,
      videos: evidence.videos, commentCount: evidence.commentCount, transcriptCount: evidence.transcriptCount, text: answer,
    };
    const saved: TopicResearch = { version: 1, topic, reports: [report, ...current.reports].slice(0, REPORTS_KEPT) };
    writeFile(researchFile(topic, true), JSON.stringify(saved, null, 2) + '\n');
    return saved;
  } finally {
    activeResearch.delete(topic);
    fs.rmSync(work, { recursive: true, force: true });
  }
}
