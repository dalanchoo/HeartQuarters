import { describe, expect, it } from 'vitest';
import { checkAiWriting } from './ai-writing.js';

describe('checkAiWriting', () => {
  it('sends the text and field label to the current AI and returns the review', async () => {
    let seenPrompt = '';
    const res = await checkAiWriting(
      "It's not about memory — it's about connection.",
      'YouTube Description',
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

  it('rejects empty or excessively long text', async () => {
    await expect(checkAiWriting('   ', 'Script')).rejects.toThrow(/no text to check/i);
    await expect(checkAiWriting('a'.repeat(40_001), 'Script')).rejects.toThrow(/too long/i);
  });
});
