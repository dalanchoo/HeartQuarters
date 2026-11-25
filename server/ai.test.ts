// vidIQ settings for each AI's command line, and checking which AI a request names. No AI runs.
import { describe, expect, it } from 'vitest';
import { CLAUDE_VIDIQ_TOOLS, CODEX_STANDARD_TIER, VIDIQ_RESEARCH_TOOLS, codexVidiq, geminiVidiqAllow, parseAi } from './ai';

describe('vidIQ', () => {
  it('offers only research tools, never ones that change the channel', () => {
    expect(VIDIQ_RESEARCH_TOOLS).toContain('vidiq_keyword_research');
    expect(VIDIQ_RESEARCH_TOOLS.some((t) => /update|upload|reply|publish|delete|remove|save/.test(t))).toBe(false);
    expect(CLAUDE_VIDIQ_TOOLS[0]).toMatch(/^mcp__claude_ai_vidIQ_for_Claude__vidiq_/);
  });

  it('keeps vidIQ off for every ChatGPT call unless a job turns it on after', () => {
    expect(CODEX_STANDARD_TIER.join(' ')).toContain('mcp_servers.vidiq.enabled_tools=[]');
    const on = codexVidiq(true).join(' ');
    expect(on).toContain('"vidiq_keyword_research"');
    expect(on).toContain('mcp_servers.vidiq.url="https://mcp.vidiq.com/mcp"');
  });

  it("gives Gemini permission for the research tools only when asked", () => {
    expect(geminiVidiqAllow(false)).toEqual([]);
    expect(geminiVidiqAllow(true)).toContain('mcp(vidiq/vidiq_youtube_search)');
  });
});

describe('which AI', () => {
  it('accepts the three AIs and nothing else', () => {
    expect(parseAi('codex')).toBe('codex');
    expect(() => parseAi('gpt')).toThrow(/Choose Claude/);
    expect(() => parseAi(undefined)).toThrow(/Choose Claude/);
  });
});
