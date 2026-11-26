import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mammoth from 'mammoth';
import { appDir, config } from './config';
import {
  attachLinkToChat,
  attachVideoPartToChat,
  buildChatPrompt,
  CHAT_DIR,
  CHAT_FILES_DIR,
  chatFilePath,
  clearChat,
  createChat,
  createFolder,
  deleteChat,
  deleteFolder,
  listChats,
  listVideoParts,
  moveChat,
  readChat,
  renameChat,
  renameFolder,
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
  it('starts empty without creating Drive files until a message, chat, folder, or upload happens', () => {
    expect(listChats()).toEqual({ version: 1, folders: [], chats: [] });
    expect(readChat()).toEqual({ version: 1, id: '', title: 'New Chat', folderId: null, messages: [] });
    expect(fs.existsSync(path.join(config.videoProjectsDir, CHAT_DIR))).toBe(false);
  });

  it('lets Claude, ChatGPT, and Gemini talk in one Drive-saved conversation', async () => {
    const seen: { ai: string; prompt: string }[] = [];
    const fakeAsk = async (ai: 'claude' | 'codex' | 'gemini', prompt: string) => {
      seen.push({ ai, prompt });
      return `Reply from ${ai}`;
    };

    const afterClaude = await sendChatMessage(null, 'claude', 'First thought', [], fakeAsk);
    expect(afterClaude.title).toBe('First thought');
    expect(afterClaude.messages.map((m) => [m.from, m.text])).toEqual([
      ['john', 'First thought'],
      ['claude', 'Reply from claude'],
    ]);

    const afterCodex = await sendChatMessage(afterClaude.id, 'codex', 'What did Claude miss?', [], fakeAsk);
    const afterGemini = await sendChatMessage(afterClaude.id, 'gemini', 'Synthesize both.', [], fakeAsk);

    expect(afterGemini.messages.map((m) => m.from)).toEqual(['john', 'claude', 'john', 'codex', 'john', 'gemini']);
    expect(seen[1].prompt).toContain('[John]\nFirst thought');
    expect(seen[1].prompt).toContain('[Claude]\nReply from claude');
    expect(seen[2].prompt).toContain('[ChatGPT]\nReply from codex');
    expect(readChat(afterClaude.id).messages).toEqual(afterGemini.messages);
    expect(afterCodex.messages).toHaveLength(4);
  });

  it('supports folders, creating, renaming, moving, and deleting conversations', async () => {
    const withFolder = createFolder('SDAM Research');
    expect(withFolder.folders.map((f) => f.name)).toEqual(['SDAM Research']);
    const folderId = withFolder.folders[0].id;

    const { chat } = createChat(folderId);
    expect(chat.title).toBe('New Chat');
    expect(chat.folderId).toBe(folderId);

    // First message auto-titles a "New Chat".
    await sendChatMessage(chat.id, 'claude', 'Outline the SDAM guide', [], async () => 'Here is an outline.');
    expect(readChat(chat.id).title).toBe('Outline the SDAM guide');

    renameChat(chat.id, 'SDAM Guide Outline');
    renameFolder(folderId, 'Research');
    expect(listChats().folders[0].name).toBe('Research');
    expect(listChats().chats[0].title).toBe('SDAM Guide Outline');

    // Deleting a folder moves its chats to the top level rather than deleting them.
    deleteFolder(folderId);
    expect(listChats().folders).toEqual([]);
    expect(readChat(chat.id).folderId).toBeNull();

    // Create a second folder and move the chat into it, then delete the chat.
    const folder2 = createFolder('Archive').folders[0].id;
    moveChat(chat.id, folder2);
    expect(readChat(chat.id).folderId).toBe(folder2);

    deleteChat(chat.id);
    expect(listChats().chats).toEqual([]);
    expect(() => readChat(chat.id)).toThrow('no longer exists');
  });

  it('creates a named folder on demand when creating a chat by folderName', () => {
    const first = createChat(null, 'Brainstorming: Video One', 'Brainstorming', 'idea-123');
    expect(first.index.folders.map((f) => f.name)).toEqual(['Brainstorming']);
    expect(first.chat.title).toBe('Brainstorming: Video One');
    expect(first.chat.folderId).toBe(first.index.folders[0].id);
    expect(first.chat.ideaId).toBe('idea-123');
    expect(first.chat.messages).toEqual([]);
    expect(readChat(first.chat.id).ideaId).toBe('idea-123');

    const second = createChat(null, 'Brainstorming: Video Two', 'brainstorming');
    expect(second.index.folders).toHaveLength(1);
    expect(second.chat.folderId).toBe(first.index.folders[0].id);
    expect(second.chat.ideaId).toBeUndefined();

    // Calling createChat again for the same ideaId returns the existing chat instead of creating a duplicate.
    const repeat = createChat(null, 'Brainstorming: Video One (Renamed)', 'Brainstorming', 'idea-123');
    expect(repeat.chat.id).toBe(first.chat.id);
    expect(repeat.index.chats).toHaveLength(2);
  });

  it('migrates a legacy single chat.json into chats.json and Threads/', () => {
    const chatDir = path.join(config.videoProjectsDir, CHAT_DIR);
    fs.mkdirSync(chatDir, { recursive: true });
    fs.writeFileSync(path.join(chatDir, 'chat.json'), JSON.stringify({
      version: 1,
      messages: [
        { id: 'm1', from: 'john', text: 'Legacy question', at: '2026-11-26T12:00:00.000Z' },
        { id: 'm2', from: 'claude', text: 'Legacy answer', at: '2026-11-26T12:01:00.000Z' },
      ],
    }));

    const index = listChats();
    expect(index.chats).toHaveLength(1);
    expect(index.chats[0].title).toBe('Legacy question');
    expect(readChat(index.chats[0].id).messages.map((m) => m.text)).toEqual(['Legacy question', 'Legacy answer']);
    expect(fs.existsSync(path.join(chatDir, 'chat.json'))).toBe(false);
  });

  it('accepts arbitrarily long pasted text without a character limit', async () => {
    const huge = 'A'.repeat(120_000);
    let seenPrompt = '';
    const res = await sendChatMessage(null, 'claude', huge, [], async (_ai, prompt) => {
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
      null,
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

  it('clears one thread and moves its unshared attached files to Trash', async () => {
    const file = uploadChatFile('Report.pdf', Buffer.from('%PDF-1.4'));
    const thread = await sendChatMessage(null, 'gemini', 'Read this', [file.name], async () => 'Done');

    const cleared = clearChat(thread.id);
    expect(cleared.messages).toEqual([]);
    expect(readChat(thread.id).messages).toEqual([]);
    expect(fs.existsSync(path.join(config.videoProjectsDir, CHAT_FILES_DIR, file.name))).toBe(false);

    const trashEntries = fs.readdirSync(config.trashDir);
    expect(trashEntries.length).toBe(1);
    expect(fs.existsSync(path.join(config.trashDir, trashEntries[0], file.name))).toBe(true);
  });

  it('loses nothing if the app data folder is deleted', async () => {
    const file = uploadChatFile('KeepMe.txt', Buffer.from('important'));
    const thread = await sendChatMessage(null, 'claude', 'Remember this', [file.name], async () => 'Saved in Drive');

    const chatDataDir = path.join(appDir, 'data', 'chat-test-dummy');
    fs.mkdirSync(chatDataDir, { recursive: true });
    fs.rmSync(chatDataDir, { recursive: true, force: true });

    expect(readChat(thread.id).messages.map((m) => m.text)).toEqual(['Remember this', 'Saved in Drive']);
    expect(fs.existsSync(chatFilePath(file.name))).toBe(true);
  });

  it('rejects blocked extensions, empty uploads, path traversal, and junctions', async () => {
    expect(() => uploadChatFile('bad.exe', Buffer.from('mz'))).toThrow('cannot be attached');
    expect(() => uploadChatFile('empty.txt', Buffer.alloc(0))).toThrow('empty');
    expect(() => chatFilePath('../secret.txt')).toThrow('valid attached file');
    await expect(sendChatMessage(null, 'other', 'Hi')).rejects.toThrow('Claude, ChatGPT, or Gemini');
    await expect(sendChatMessage(null, 'claude', '   ', [])).rejects.toThrow('Type a message or attach a file');

    const elsewhere = makeTree({ 'secret.txt': 'nope' });
    try {
      fs.mkdirSync(path.dirname(path.join(config.videoProjectsDir, CHAT_DIR)), { recursive: true });
      fs.symlinkSync(elsewhere, path.join(config.videoProjectsDir, CHAT_DIR), 'junction');
      expect(() => listChats()).toThrow();
      await expect(sendChatMessage(null, 'claude', 'Hi')).rejects.toThrow();
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
    const res = await sendChatMessage(null, 'gemini', 'Draw a calm ocean sunrise', [], async (_ai, prompt, cwd) => {
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

      const res = await sendChatMessage(null, 'gemini', 'Draw a guide image', [], async () => {
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

  it('captures file:/// video links in AI Markdown and rewrites them to /api/chat/file URLs', async () => {
    const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const externalDir = makeTree({ 'brain/': '' });
    try {
      const externalVideo = path.join(externalDir, 'brain', 'the_edge_of_light.mp4');
      fs.writeFileSync(externalVideo, mp4Bytes);
      const fileUrl = `file:///${externalVideo.replace(/\\/g, '/')}`;

      const res = await sendChatMessage(null, 'gemini', 'Make a cool video', [], async () => {
        return `Video: [the edge of light.mp4](${fileUrl})`;
      });

      const reply = res.messages[1];
      expect(reply.files).toEqual(['the_edge_of_light.mp4']);
      expect(reply.text).toBe('Video: [the edge of light.mp4](/api/chat/file?name=the_edge_of_light.mp4)');
      expect(fs.readFileSync(chatFilePath('the_edge_of_light.mp4')).equals(mp4Bytes)).toBe(true);
    } finally {
      removeTree(externalDir);
    }
  });

  it('resolves #Videos/ and web links for attachLinkToChat', async () => {
    const sub = path.join(config.videoProjectsDir, '003 - SDAM', 'Longform', 'Subtitles');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, '003.srt'), '1\n00:00:00,000 --> 00:00:02,000\nHello SDAM.\n');

    const attached = await attachLinkToChat('#Videos/003%20-%20SDAM', '003 - SDAM');
    expect(attached.kind).toBe('file');
    if (attached.kind === 'file') {
      expect(attached.file.name).toBe('003 - SDAM (Transcript).txt');
      expect(fs.readFileSync(chatFilePath(attached.file.name), 'utf8')).toContain('Hello SDAM.');
    }

    const web = await attachLinkToChat('https://example.com/article', 'SDAM Article');
    expect(web).toEqual({ kind: 'text', text: '[SDAM Article](https://example.com/article)' });
  });

  it('resumes the same AI session without resending history, and sends full history when switching AIs', async () => {
    const calls: { ai: string; prompt: string; isResume?: boolean; sessionId?: string }[] = [];
    const fakeAsk = async (
      ai: 'claude' | 'codex' | 'gemini',
      prompt: string,
      _cwd: string,
      _images?: string[],
      opts?: { sessionId?: string; isResume?: boolean },
    ) => {
      calls.push({ ai, prompt, isResume: opts?.isResume, sessionId: opts?.sessionId });
      return { text: `Reply ${calls.length} from ${ai}`, sessionId: `${ai}-sess-1` };
    };

    const t1 = await sendChatMessage(null, 'claude', 'Turn 1', [], fakeAsk);
    expect(calls[0].isResume).toBe(false);
    expect(calls[0].prompt).toContain('--- CONVERSATION SO FAR ---');

    // Consecutive turn to Claude resumes claude-sess-1 with only the new message.
    await sendChatMessage(t1.id, 'claude', 'Turn 2', [], fakeAsk);
    expect(calls[1].isResume).toBe(true);
    expect(calls[1].sessionId).toBe('claude-sess-1');
    expect(calls[1].prompt).toBe('Turn 2');

    // Switching to ChatGPT sends the full conversation history.
    await sendChatMessage(t1.id, 'codex', 'Turn 3', [], fakeAsk);
    expect(calls[2].isResume).toBe(false);
    expect(calls[2].prompt).toContain('Turn 1');
    expect(calls[2].prompt).toContain('Reply 2 from claude');

    // Consecutive turn to ChatGPT resumes codex-sess-1 with only the new message.
    await sendChatMessage(t1.id, 'codex', 'Turn 4', [], fakeAsk);
    expect(calls[3].isResume).toBe(true);
    expect(calls[3].sessionId).toBe('codex-sess-1');
    expect(calls[3].prompt).toBe('Turn 4');

    // Returning to Claude resumes claude-sess-1 and sends only the missed ChatGPT turns, not Turn 1 or Turn 2.
    await sendChatMessage(t1.id, 'claude', 'Turn 5', [], fakeAsk);
    expect(calls[4].isResume).toBe(true);
    expect(calls[4].sessionId).toBe('claude-sess-1');
    expect(calls[4].prompt).toContain('--- MESSAGES SINCE YOU LAST REPLIED ---');
    expect(calls[4].prompt).toContain('Turn 3');
    expect(calls[4].prompt).toContain('Reply 4 from codex');
    expect(calls[4].prompt).toContain("--- JOHN'S NEW MESSAGE ---\nTurn 5");
    expect(calls[4].prompt).not.toContain('Turn 1');
    expect(calls[4].prompt).not.toContain('Reply 2 from claude');

    // Clearing resets all cached sessions for this chat.
    clearChat(t1.id);
    await sendChatMessage(t1.id, 'codex', 'Fresh start', [], fakeAsk);
    expect(calls[5].isResume).toBe(false);
  });

  it('lists video parts (captions, script, packaging, thumbnail, exports) and attaches any chosen part', () => {
    const lf = path.join(config.videoProjectsDir, '003 - SDAM', 'Longform');
    fs.mkdirSync(path.join(lf, 'Subtitles'), { recursive: true });
    fs.mkdirSync(path.join(lf, 'Packaging', 'V01', 'Thumbnail'), { recursive: true });
    fs.mkdirSync(path.join(lf, 'Exports'), { recursive: true });
    fs.writeFileSync(path.join(lf, 'Subtitles', '003-captions.txt'), 'Plain text captions');
    fs.writeFileSync(path.join(lf, 'Subtitles', '003-captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
    fs.writeFileSync(path.join(lf, '003 - SDAM - Script.docx'), 'docx-bytes');
    fs.writeFileSync(path.join(lf, 'Packaging', 'V01', 'YouTube.md'), '# Title');
    fs.writeFileSync(path.join(lf, 'Packaging', 'V01', 'Thumbnail', 'Thumbnail.png'), 'png-bytes');
    fs.writeFileSync(path.join(lf, 'Exports', '003 - SDAM.mp4'), 'mp4-bytes');

    const parts = listVideoParts('#Videos/003%20-%20SDAM');
    expect(parts.map((p) => p.label)).toEqual([
      '003-captions.srt',
      '003-captions.txt',
      '003 - SDAM - Script.docx',
      'V01 · YouTube.md',
      'V01 · Thumbnail.png',
      'Export · 003 - SDAM.mp4',
    ]);

    const attached = attachVideoPartToChat(parts[1].relPath);
    expect(attached.name).toBe('003-captions.txt');
    expect(fs.readFileSync(chatFilePath('003-captions.txt'), 'utf8')).toBe('Plain text captions');
  });
});
