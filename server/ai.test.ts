// vidIQ settings for each AI's command line, and checking which AI a request names. No AI runs.
import { describe, expect, it } from 'vitest';
import { CLAUDE_VIDIQ_TOOLS, CODEX_STANDARD_TIER, VIDIQ_RESEARCH_TOOLS, codexVidiq, geminiAnswer, geminiStdin, geminiVidiqAllow, parseAi, runAiProcess } from './ai';

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

describe('running an AI program', () => {
  it('hands it a prompt too long for a Windows command line through stdin', async () => {
    const prompt = 'x'.repeat(40_000);
    const res = await runAiProcess(process.execPath, ['-e', "let n=0;process.stdin.on('data',c=>n+=c.length).on('end',()=>console.log(n))"], { cwd: process.cwd(), timeoutMs: 20_000, input: prompt });
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('40000');
  });
});

describe("Gemini's prompt through stdin", () => {
  it('sends one JSON user message and reads the last result', () => {
    const { args, input } = geminiStdin('Say "hi"\nplease');
    expect(args).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--print=']);
    expect(JSON.parse(input)).toEqual({ event: 'user', message: { role: 'user', content: 'Say "hi"\nplease' } });
    expect(input.trim().split('\n')).toHaveLength(1);
    const out = ['{"event":"init"}', 'not json', '{"event":"result","result":{"status":"SUCCESS","response":"hi\\n"}}'].join('\n');
    expect(geminiAnswer(out)).toBe('hi\n');
  });

  it("passes on Gemini's error, or says there was no answer", () => {
    expect(() => geminiAnswer('{"event":"result","result":{"status":"ERROR","error":"not signed in"}}')).toThrow('not signed in');
    expect(() => geminiAnswer('{"event":"init"}')).toThrow(/without an answer/);
  });
});

describe('which AI', () => {
  it('accepts the three AIs and nothing else', () => {
    expect(parseAi('codex')).toBe('codex');
    expect(() => parseAi('gpt')).toThrow(/Choose Claude/);
    expect(() => parseAi(undefined)).toThrow(/Choose Claude/);
  });
});
