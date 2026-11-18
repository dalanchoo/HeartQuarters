// "Draft" in View and Compare Packaging: the packaging Generate Packaging made for the chosen pair (title,
// description, hashtags, tags, pinned comment, thumbnail text) and one of its draft images. It comes first in the
// menus, like a V00, and is never changed or sent to YouTube directly: John copies it into an unlocked version first.
import type { BriefChoice, BriefPick, DraftConversation, FileRef } from './api';
import { splitHashtags } from './youtubePackaging';

/** Whether the saved choice is still one of the current top 3 (an old choice is for an earlier brief). */
export function isCurrentChoice(choice: BriefChoice | null, picks: BriefPick[] | null): boolean {
  const pick = choice && picks?.[choice.index];
  return !!pick && JSON.stringify(pick) === JSON.stringify(choice?.pick);
}

/** The Draft as a YouTube.md-style text, so it compares and copies like any version's file. */
export function draftText(pick: BriefPick): string {
  const parts = splitHashtags(pick.description ?? '');
  const fields = [
    { label: 'Title', value: pick.title },
    { label: 'Description', value: parts.description },
    { label: 'Hashtags', value: parts.hashtags },
    { label: 'Tags', value: pick.tags },
    { label: 'Pinned Comment', value: pick.pinnedComment },
    { label: 'Thumbnail text', value: pick.thumbnailText.toUpperCase() },
    // The channel's usual YouTube settings (John, 2026-11-17): English (US), not made for kids, no altered content.
    { label: 'Video language', value: 'en-US' },
    { label: 'Made for kids', value: 'No' },
    { label: 'Altered content', value: 'No' },
  ].filter((f): f is { label: string; value: string } => !!f.value);
  return fields.map((f) => `${f.label}:\n${f.value}`).join('\n\n') + '\n';
}

/** The draft images made for the chosen pair, newest first, each labelled with its conversation and round. */
export function draftImages(choice: BriefChoice, conversations: DraftConversation[]): (FileRef & { label: string })[] {
  const made = conversations
    .filter((c) => c.pick?.title === choice.pick.title)
    .flatMap((c, ci) => c.images.map((image, ii) => ({ ...image, label: `${c.name} · Round ${image.name.replace(/\.[^.]+$/, '')}`, order: ci * 1000 + ii })));
  return made.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || b.order - a.order).map(({ order: _order, ...image }) => image);
}
