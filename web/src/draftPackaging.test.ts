import { describe, expect, it } from 'vitest';
import { draftImages, draftText, isCurrentChoice } from './draftPackaging';
import type { BriefChoice, BriefPick, DraftConversation } from './api';

const PICK = { title: 'T', thumbnailText: 'Remember me?', accent: 'ME?', expression: 'Positive > Warmth', background: 'dark', why: 'w', backedBy: [], description: 'About it.\n\n#SDAM #Memory', tags: 'a, b', pinnedComment: 'Question?' } as BriefPick;
const choice: BriefChoice = { pick: PICK, index: 0, photo: null };
const img = (name: string, modified: number) => ({ name, path: `D/${name}`, size: 1, modified });

describe('the Draft', () => {
  it("is written like a YouTube.md, with the hashtags in their own field", () => {
    const settings = '\n\nVideo language:\nen-US\n\nMade for kids:\nNo\n\nAltered content:\nNo\n';
    expect(draftText(PICK)).toBe('Title:\nT\n\nDescription:\nAbout it.\n\nHashtags:\n#SDAM #Memory\n\nTags:\na, b\n\nPinned Comment:\nQuestion?\n\nThumbnail text:\nREMEMBER ME?' + settings);
    expect(draftText({ ...PICK, description: undefined, tags: undefined, pinnedComment: undefined })).toBe('Title:\nT\n\nThumbnail text:\nREMEMBER ME?' + settings);
  });
  it("lists the pair's images newest first, and no other pair's", () => {
    const conversations = [
      { name: 'ChatGPT 01', path: 'c1', images: [img('01.png', 10), img('02.png', 30)], requests: null, pick: PICK, photo: null },
      { name: 'Gemini 01', path: 'g1', images: [img('01.png', 20)], requests: null, pick: PICK, photo: null },
      { name: 'ChatGPT 02', path: 'c2', images: [img('01.png', 99)], requests: null, pick: { ...PICK, title: 'Other' }, photo: null },
    ] as DraftConversation[];
    expect(draftImages(choice, conversations).map((i) => i.label)).toEqual(['ChatGPT 01 · Round 02', 'Gemini 01 · Round 01', 'ChatGPT 01 · Round 01']);
  });
  it('is only offered for a choice that is still in the top 3', () => {
    expect(isCurrentChoice(choice, [PICK])).toBe(true);
    expect(isCurrentChoice(choice, [{ ...PICK, title: 'New' }])).toBe(false);
    expect(isCurrentChoice(null, [PICK])).toBe(false);
  });
});
