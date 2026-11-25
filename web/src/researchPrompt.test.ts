import { describe, expect, it } from 'vitest';
import { combineNotes, researchQuestion } from './researchPrompt';

describe('the research question for vidIQ and Ask Studio', () => {
  it("names the Short, says where it is, and what it's about", () => {
    const q = researchQuestion({ title: "They Remember Our Childhood. I Don't.", about: 'With SDAM, my friends remember.', short: true, url: 'https://youtube.com/shorts/x' });
    expect(q).toMatch(/^I'm choosing the title and cover for my YouTube Short "They Remember Our Childhood\. I Don't\.", which is on my channel at https:\/\/youtube\.com\/shorts\/x\./);
    expect(q).toContain("What it's about: With SDAM, my friends remember.");
    expect(q).toContain('suggest 5 title and cover pairs');
    expect(q).toContain('true to what actually happens');
  });
  it.each([
    ['longform', false, 'https://youtube.com/watch?v=x'],
    ['Short', true, 'https://youtube.com/shorts/x'],
  ])('requires a readable transcript before making suggestions for a published %s', (_, short, url) => {
    const q = researchQuestion({ title: 'T', about: 'Description context', short, url });
    const warning = 'reply only with: TRANSCRIPT UNAVAILABLE. PASTE THE TRANSCRIPT TO CONTINUE.';
    expect(q).toContain('First, read the spoken transcript for this exact video, or use a transcript I provide.');
    expect(q).toContain(warning);
    expect(q).toContain('Never guess from the title, thumbnail, description, or chapters.');
    expect(q.indexOf(warning)).toBeLessThan(q.indexOf("What it's about:"));
    expect(q.indexOf(warning)).toBeLessThan(q.indexOf('suggest 5 title'));
  });

  it('works for a longform video not on YouTube yet, with no title', () => {
    const q = researchQuestion({ title: '', about: '', short: false });
    expect(q).toMatch(/^I'm choosing the title and thumbnail for my next YouTube video, which isn't on YouTube yet\./);
    expect(q).not.toContain("What it's about");
    expect(q).not.toContain('TRANSCRIPT UNAVAILABLE');
    expect(q).toContain('under about 60 characters');
  });
  it('asks for plain text with no tables or links, before the transcript', () => {
    const q = researchQuestion({ title: 'T', about: '', short: false, source: { kind: 'transcript', text: 'Hello' } });
    expect(q).toContain('Answer in plain text only');
    expect(q).toContain('no tables, cards, icons');
    expect(q).toContain('=== END OF SECTION ===');
    expect(q.indexOf('plain text only')).toBeLessThan(q.indexOf("video's transcript:"));
  });
  it("adds the transcript (or script) while it isn't on YouTube, and leaves it out once it is", () => {
    const transcript = { kind: 'transcript' as const, text: ' So I told them. ' };
    expect(researchQuestion({ title: 'T', about: '', short: true, source: transcript })).toMatch(/\n\nThe Short's transcript:\nSo I told them\.$/);
    expect(researchQuestion({ title: 'T', about: '', short: false, source: { kind: 'script', text: 'Hello' } })).toMatch(/The video's script \(the recording may differ\):\nHello$/);
    expect(researchQuestion({ title: 'T', about: '', short: true, url: 'https://youtube.com/shorts/x', source: transcript })).not.toContain('So I told them');
  });
});

describe('combining the notes boxes', () => {
  it('puts each filled box under its own heading and leaves out empty ones', () => {
    expect(combineNotes(' mine ', '', 'studio says')).toBe("John's notes:\nmine\n\nResearch from YouTube's Ask Studio:\nstudio says");
    expect(combineNotes('', '', '')).toBe('');
  });
});
