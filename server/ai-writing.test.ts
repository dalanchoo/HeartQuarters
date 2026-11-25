import { describe, expect, it } from 'vitest';
import { checkAiWriting } from './ai-writing.js';

describe('checkAiWriting', () => {
  it('sends the text and field label to the current AI and returns the review', async () => {
    let seenPrompt = '';
    const res = await checkAiWriting(
      "It's not about memory — it's about connection.",
      'YouTube Description',
      'claude',
      async (_ai, prompt) => {
        seenPrompt = prompt;
        return '- **"It\'s not about memory — it\'s about connection."** Sounds like a formulaic AI contrast.';
      },
    );
    expect(seenPrompt).toContain('YouTube Description');
    expect(seenPrompt).toContain("It's not about memory — it's about connection.");
    expect(res.review).toContain('formulaic AI contrast');
    expect(res.aiName).toBeTruthy();
  });

  it('keeps whole-sentence rewrites that are in the text, in text order, without overlaps', async () => {
    const text = 'I lost my past. It is not about memory, it is about connection. Here is the thing: I am fine.';
    const answer = 'Sure!\n' + JSON.stringify({ summary: 'Two spots.', suggestions: [
      { find: 'Here is the thing: I am fine.', replace: 'I am fine.', why: 'Throat-clearing.' },
      { find: 'It is not about memory, it is about connection.', replace: 'It is about connection.', why: 'Contrast formula.' },
      { find: 'not about memory', replace: 'x', why: 'Overlaps the one above.' },
      { find: 'Words that are not there.', replace: 'y', why: 'Made up.' },
    ] });
    const res = await checkAiWriting(text, 'YouTube Description', 'claude', async () => answer);
    expect(res.review).toBe('Two spots.');
    expect(res.suggestions.map((s) => s.replace)).toEqual(['It is about connection.', 'I am fine.']);
  });

  it('shows an answer that is not the JSON asked for as it is', async () => {
    const res = await checkAiWriting('Some text.', 'Title', 'claude', async () => 'It reads naturally.');
    expect(res).toMatchObject({ review: 'It reads naturally.', suggestions: [] });
  });

  it('rejects empty or excessively long text', async () => {
    await expect(checkAiWriting('   ', 'Script')).rejects.toThrow(/no text to check/i);
    await expect(checkAiWriting('a'.repeat(40_001), 'Script')).rejects.toThrow(/too long/i);
  });
});
