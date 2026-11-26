import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import { appDir, config } from './config';
import {
  buildChatPrompt,
  CHAT_DIR,
  CHAT_FILES_DIR,
  chatFilePath,
  clearChat,
  readChat,
  sendChatMessage,
  uploadChatFile,
} from './chat';
import { makeTree, removeTree } from './testing';

let root: string;
let savedProjects: string;
let savedTrash: string;

beforeEach(() => {
  root = makeTree({ 'Projects/': '', 'Trash/': '' });
  savedProjects = config.videoProjectsDir;
  savedTrash = config.trashDir;
  config.videoProjectsDir = path.join(root, 'Projects');
  config.trashDir = path.join(root, 'Trash');
});

afterEach(() => {
  config.videoProjectsDir = savedProjects;
  config.trashDir = savedTrash;
  vi.restoreAllMocks();
  removeTree(root);
});

describe('full-screen multi-AI chat', () => {
  it('starts empty without creating Drive files until a message or upload happens', () => {
    expect(readChat()).toEqual({ version: 1, messages: [] });
    expect(fs.existsSync(path.join(config.videoProjectsDir, CHAT_DIR))).toBe(false);
  });

  it('lets Claude, ChatGPT, and Gemini talk in one Drive-saved conversation', async () => {
    const seen: { ai: string; prompt: string }[] = [];
    const fakeAsk = async (ai: 'claude' | 'codex' | 'gemini', prompt: string) => {
      seen.push({ ai, prompt });
      return `Reply from ${ai}`;
    };

    const afterClaude = await sendChatMessage('claude', 'First thought', [], fakeAsk);
    expect(afterClaude.messages.map((m) => [m.from, m.text])).toEqual([
      ['john', 'First thought'],
      ['claude', 'Reply from claude'],
    ]);

    const afterCodex = await sendChatMessage('codex', 'What did Claude miss?', [], fakeAsk);
    const afterGemini = await sendChatMessage('gemini', 'Synthesize both.', [], fakeAsk);

    expect(afterGemini.messages.map((m) => m.from)).toEqual(['john', 'claude', 'john', 'codex', 'john', 'gemini']);
    expect(seen[1].prompt).toContain('[John]\nFirst thought');
    expect(seen[1].prompt).toContain('[Claude]\nReply from claude');
    expect(seen[2].prompt).toContain('[ChatGPT]\nReply from codex');
    expect(readChat().messages).toEqual(afterGemini.messages);
    expect(afterCodex.messages).toHaveLength(4);
  });

  it('accepts arbitrarily long pasted text without a character limit', async () => {
    const huge = 'A'.repeat(120_000);
    let seenPrompt = '';
    const res = await sendChatMessage('claude', huge, [], async (_ai, prompt) => {
      seenPrompt = prompt;
      return 'Got all of it.';
    });
    expect(res.messages[0].text.length).toBe(120_000);
    expect(seenPrompt).toContain(huge);
  });

  it('saves uploaded files of any format, extracts .docx text, and passes images to the AI', async () => {
    const pdf = uploadChatFile('Research.pdf', Buffer.from('%PDF-1.4\nhello'));
    const docx = uploadChatFile('Notes.docx', Buffer.from('PK-fake-docx'));
    const png = uploadChatFile('Screenshot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(pdf.name).toBe('Research.pdf');
    expect(docx.name).toBe('Notes.docx');
    expect(png.name).toBe('Screenshot.png');

    // Duplicate file names are numbered rather than overwriting.
    const pdf2 = uploadChatFile('Research.pdf', Buffer.from('%PDF-1.4\nv2'));
    expect(pdf2.name).toBe('Research (2).pdf');

    vi.spyOn(mammoth, 'extractRawText').mockResolvedValue({
      value: 'Extracted Word doc text',
      messages: [],
    });

    let sawFiles: Record<string, boolean> = {};
    let extractedText = '';
    let passedImages: string[] = [];
    let promptSeen = '';

    await sendChatMessage(
      'codex',
      '',
      [pdf.name, docx.name, png.name],
      async (_ai, prompt, cwd, images = []) => {
        promptSeen = prompt;
        passedImages = images.map((p) => path.basename(p));
        sawFiles = {
          pdf: fs.existsSync(path.join(cwd, 'Research.pdf')),
          docx: fs.existsSync(path.join(cwd, 'Notes.docx')),
          docxTxt: fs.existsSync(path.join(cwd, 'Notes.docx.txt')),
          png: fs.existsSync(path.join(cwd, 'Screenshot.png')),
        };
        extractedText = fs.readFileSync(path.join(cwd, 'Notes.docx.txt'), 'utf8');
        return 'Reviewed all three.';
      },
    );

    expect(sawFiles).toEqual({ pdf: true, docx: true, docxTxt: true, png: true });
    expect(extractedText).toBe('Extracted Word doc text');
    expect(passedImages).toEqual(['Screenshot.png']);
    expect(promptSeen).toContain('Notes.docx (extracted text also saved as Notes.docx.txt)');
    expect(promptSeen).toContain("Look at the attached file(s).\n[Attached: Research.pdf, Notes.docx, Screenshot.png]");
  });

  it('clears the thread and moves attached files to Trash', async () => {
    const file = uploadChatFile('Report.pdf', Buffer.from('%PDF-1.4'));
    await sendChatMessage('gemini', 'Read this', [file.name], async () => 'Done');

    const cleared = clearChat();
    expect(cleared.messages).toEqual([]);
    expect(readChat().messages).toEqual([]);
    expect(fs.existsSync(path.join(config.videoProjectsDir, CHAT_FILES_DIR, file.name))).toBe(false);

    const trashEntries = fs.readdirSync(config.trashDir);
    expect(trashEntries.length).toBe(1);
    expect(fs.existsSync(path.join(config.trashDir, trashEntries[0], file.name))).toBe(true);
  });

  it('loses nothing if the app data folder is deleted', async () => {
    const file = uploadChatFile('KeepMe.txt', Buffer.from('important'));
    await sendChatMessage('claude', 'Remember this', [file.name], async () => 'Saved in Drive');

    const chatDataDir = path.join(appDir, 'data', 'chat-test-dummy');
    fs.mkdirSync(chatDataDir, { recursive: true });
    fs.rmSync(chatDataDir, { recursive: true, force: true });

    expect(readChat().messages.map((m) => m.text)).toEqual(['Remember this', 'Saved in Drive']);
    expect(fs.existsSync(chatFilePath(file.name))).toBe(true);
  });

  it('rejects blocked extensions, empty uploads, path traversal, and junctions', async () => {
    expect(() => uploadChatFile('bad.exe', Buffer.from('mz'))).toThrow('cannot be attached');
    expect(() => uploadChatFile('empty.txt', Buffer.alloc(0))).toThrow('empty');
    expect(() => chatFilePath('../secret.txt')).toThrow('valid attached file');
    await expect(sendChatMessage('other', 'Hi')).rejects.toThrow('Claude, ChatGPT, or Gemini');
    await expect(sendChatMessage('claude', '   ', [])).rejects.toThrow('Type a message or attach a file');

    const elsewhere = makeTree({ 'secret.txt': 'nope' });
    try {
      fs.mkdirSync(path.dirname(path.join(config.videoProjectsDir, CHAT_DIR)), { recursive: true });
      fs.symlinkSync(elsewhere, path.join(config.videoProjectsDir, CHAT_DIR), 'junction');
      expect(() => readChat()).toThrow();
      await expect(sendChatMessage('claude', 'Hi')).rejects.toThrow();
    } finally {
      removeTree(elsewhere);
    }
  });

  it('builds a clean prompt when no files or messages exist yet', () => {
    const prompt = buildChatPrompt([], 'Hello', [], 'gemini');
    expect(prompt).toContain('You are Gemini');
    expect(prompt).toContain('--- ATTACHED FILES IN YOUR WORKING FOLDER ---\n(none)');
    expect(prompt).toContain('--- CONVERSATION SO FAR ---\n(no messages yet)');
  });

  it('saves images generated by an AI into Drive and attaches them to its reply', async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await sendChatMessage('gemini', 'Draw a calm ocean sunrise', [], async (_ai, prompt, cwd) => {
      expect(prompt).toContain('image generation tool');
      expect(prompt).not.toContain('Do not create, edit, or delete any files.');
      const outImg = path.join(cwd, 'sunrise.png');
      fs.writeFileSync(outImg, pngBytes);
      return { text: 'Here is a calm ocean sunrise.', generatedImages: [outImg] };
    });

    const reply = res.messages[1];
    expect(reply.from).toBe('gemini');
    expect(reply.text).toBe('Here is a calm ocean sunrise.');
    expect(reply.files).toEqual(['sunrise.png']);
    expect(fs.readFileSync(chatFilePath('sunrise.png')).equals(pngBytes)).toBe(true);
  });

  it('captures file:/// image links in AI Markdown and rewrites them to /api/chat/file URLs', async () => {
    const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const externalDir = makeTree({ 'brain/': '' });
    try {
      const externalImg = path.join(externalDir, 'brain', 'sdam guide.jpg');
      fs.writeFileSync(externalImg, jpgBytes);
      const fileUrl = `file:///${externalImg.replace(/\\/g, '/')}`;

      const res = await sendChatMessage('gemini', 'Draw a guide image', [], async () => {
        return `![Guide](${encodeURI(fileUrl)})\n\nSaved at: [sdam guide.jpg](${encodeURI(fileUrl)})`;
      });

      const reply = res.messages[1];
      expect(reply.files).toEqual(['sdam guide.jpg']);
      expect(reply.text).toContain('![Guide](/api/chat/file?name=sdam%20guide.jpg)');
      expect(reply.text).toContain('[sdam guide.jpg](/api/chat/file?name=sdam%20guide.jpg)');
      expect(reply.text).not.toContain('file:///');
      expect(fs.readFileSync(chatFilePath('sdam guide.jpg')).equals(jpgBytes)).toBe(true);
    } finally {
      removeTree(externalDir);
    }
  });
});
