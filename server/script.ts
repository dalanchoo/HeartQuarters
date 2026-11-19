// Reading and editing a video's or standalone Short's script (.docx, or an existing .md/.txt script) directly inside
// HeartQuarters. Saving writes a real Word (.docx) document with headings, bold/italic/underline/strikethrough,
// bulleted and numbered lists (including nested indent levels), and blockquotes so it opens cleanly in Google Docs,
// Microsoft Word, and HeartQuarters.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import mammoth from 'mammoth';
import { config, safeResolve } from './config.js';
import { readable, readText, writeFile } from './safe-files.js';

export interface ScriptFile {
  /** Filename inside the piece folder, e.g. "022 - Worth Telling Them - Script.docx". */
  name: string;
  /** Relative path from Video Projects, with forward slashes. */
  path: string;
  /** Whether the file already exists on disk. */
  exists: boolean;
  /** Rich HTML contents for the WYSIWYG editor. */
  html: string;
  /** Plain-text representation for Copy Script and Write Brief. */
  text: string;
}

const MAMMOTH_STYLE_MAP = [
  'u => u',
  'strike => s',
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
];

function pieceFolder(piece: string): string {
  if (!piece) throw new Error('No video given.');
  const dir = safeResolve('projects', piece);
  if (!fs.existsSync(path.join(dir, 'Packaging'))) throw new Error(`"${piece}" has no Packaging folder.`);
  return dir;
}

function rel(full: string): string {
  return path.relative(config.videoProjectsDir, full).split(path.sep).join('/');
}

function defaultScriptName(pieceDir: string): string {
  const base = path.basename(pieceDir).toLowerCase() === 'longform' ? path.basename(path.dirname(pieceDir)) : path.basename(pieceDir);
  return `${base} - Script.docx`;
}

/** Finds the newest script file in the piece folder, preferring .docx when present. */
export function findScriptFile(pieceDir: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(pieceDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return null;
  }
  const scripts = entries
    .filter((f) => /script/i.test(f) && /\.(docx|md|txt)$/i.test(f) && !f.startsWith('~$'))
    .map((f) => path.join(pieceDir, f))
    .sort((a, b) => {
      const aDocx = /\.docx$/i.test(a) ? 1 : 0;
      const bDocx = /\.docx$/i.test(b) ? 1 : 0;
      if (aDocx !== bDocx) return bDocx - aDocx;
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    });
  return scripts[0] ?? null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encodeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Converts plain text (with optional "- " bullets or "1. " numbered lines) into simple HTML paragraphs and lists. */
export function plainTextToHtml(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listKind: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (listKind) {
      out.push(`</${listKind}>`);
      listKind = null;
    }
  };
  for (const raw of lines) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (bullet) {
      if (listKind !== 'ul') {
        closeList();
        out.push('<ul>');
        listKind = 'ul';
      }
      out.push(`<li>${encodeXml(bullet[1])}</li>`);
    } else if (numbered) {
      if (listKind !== 'ol') {
        closeList();
        out.push('<ol>');
        listKind = 'ol';
      }
      out.push(`<li>${encodeXml(numbered[1])}</li>`);
    } else {
      closeList();
      if (raw.trim()) out.push(`<p>${encodeXml(raw)}</p>`);
      else out.push('<p></p>');
    }
  }
  closeList();
  return out.join('');
}

interface InlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/** Converts inline HTML inside a paragraph or list item into Word <w:r> runs. */
function inlineHtmlToWordRuns(html: string): string {
  const stack: InlineState[] = [{ bold: false, italic: false, underline: false, strike: false }];
  const runs: string[] = [];
  const tokenRe = /<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*)?>|([^<]+)/g;
  let m: RegExpExecArray | null;

  const pushText = (raw: string) => {
    const text = decodeHtmlEntities(raw);
    if (!text) return;
    const cur = stack[stack.length - 1];
    const rPrParts: string[] = [];
    if (cur.bold) rPrParts.push('<w:b/>');
    if (cur.italic) rPrParts.push('<w:i/>');
    if (cur.underline) rPrParts.push('<w:u w:val="single"/>');
    if (cur.strike) rPrParts.push('<w:strike/>');
    const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
    runs.push(`<w:r>${rPr}<w:t xml:space="preserve">${encodeXml(text)}</w:t></w:r>`);
  };

  while ((m = tokenRe.exec(html)) !== null) {
    if (m[3] !== undefined) {
      pushText(m[3]);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br' && !closing) {
      runs.push('<w:r><w:br/></w:r>');
      continue;
    }
    const isStyleTag =
      tag === 'b' ||
      tag === 'strong' ||
      tag === 'i' ||
      tag === 'em' ||
      tag === 'u' ||
      tag === 's' ||
      tag === 'strike' ||
      tag === 'del';
    if (!isStyleTag) continue;
    if (closing) {
      if (stack.length > 1) stack.pop();
    } else {
      const prev = stack[stack.length - 1];
      stack.push({
        bold: prev.bold || tag === 'b' || tag === 'strong',
        italic: prev.italic || tag === 'i' || tag === 'em',
        underline: prev.underline || tag === 'u',
        strike: prev.strike || tag === 's' || tag === 'strike' || tag === 'del',
      });
    }
  }
  return runs.join('');
}

interface ParagraphSpec {
  style?: 'Heading1' | 'Heading2' | 'Heading3' | 'Quote';
  list?: { numId: 1 | 2; ilvl: number };
  inlineHtml: string;
}

/** Parses editor HTML into a flat sequence of Word paragraphs (handling nested <ul>/<ol>, headings, blockquotes, and paragraphs). */
function htmlToParagraphSpecs(html: string): ParagraphSpec[] {
  const specs: ParagraphSpec[] = [];
  const listStack: { numId: 1 | 2 }[] = [];
  let inBlockquote = false;
  let currentStyle: ParagraphSpec['style'] | undefined;
  let buf = '';

  const flushParagraph = (forceEmpty = false) => {
    const cleaned = buf.replace(/^\s+|\s+$/g, '');
    buf = '';
    if (!cleaned && !forceEmpty) return;
    if (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      const ilvl = Math.min(3, listStack.length - 1);
      specs.push({ list: { numId: top.numId, ilvl }, inlineHtml: cleaned });
    } else {
      specs.push({
        style: currentStyle ?? (inBlockquote ? 'Quote' : undefined),
        inlineHtml: cleaned,
      });
    }
  };

  const blockTags = new Set(['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li']);
  const tagRe = /<(\/?)([a-zA-Z0-9]+)(?:\s[^>]*)?>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[2].toLowerCase();
    if (!blockTags.has(tag)) continue;

    buf += html.slice(lastIndex, m.index);
    lastIndex = tagRe.lastIndex;
    const closing = m[1] === '/';

    if (tag === 'ul' || tag === 'ol') {
      if (!closing) {
        if (buf.trim()) flushParagraph();
        else buf = '';
        listStack.push({ numId: tag === 'ul' ? 1 : 2 });
      } else {
        if (buf.trim()) flushParagraph();
        else buf = '';
        listStack.pop();
      }
    } else if (tag === 'li') {
      if (!closing) {
        if (buf.trim()) flushParagraph();
        else buf = '';
      } else {
        flushParagraph(true);
      }
    } else if (tag === 'blockquote') {
      if (!closing) {
        if (buf.trim()) flushParagraph();
        else buf = '';
        inBlockquote = true;
      } else {
        flushParagraph();
        inBlockquote = false;
      }
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      if (!closing) {
        if (buf.trim()) flushParagraph();
        else buf = '';
        currentStyle = tag === 'h1' ? 'Heading1' : tag === 'h2' ? 'Heading2' : 'Heading3';
      } else {
        flushParagraph(true);
        currentStyle = undefined;
      }
    } else if (tag === 'p' || tag === 'div') {
      if (!closing) {
        if (buf.trim()) flushParagraph();
        else buf = '';
      } else {
        if (listStack.length === 0) flushParagraph(true);
      }
    }
  }

  buf += html.slice(lastIndex);
  if (buf.trim() || specs.length === 0) flushParagraph(specs.length === 0);
  return specs;
}

/** Converts rich HTML into readable plain text (for Copy Script and Write Brief). */
export function htmlToPlainText(html: string): string {
  const specs = htmlToParagraphSpecs(html);
  const counters = [0, 0, 0, 0];
  return specs
    .map((p) => {
      const text = decodeHtmlEntities(
        p.inlineHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, ''),
      );
      if (p.list) {
        const lvl = p.list.ilvl;
        const indent = '  '.repeat(lvl);
        if (p.list.numId === 1) {
          counters[lvl] = 0;
          return `${indent}- ${text}`;
        }
        counters[lvl] = (counters[lvl] ?? 0) + 1;
        return `${indent}${counters[lvl]}. ${text}`;
      }
      counters.fill(0);
      return text;
    })
    .join('\n')
    .trimEnd();
}

/** Builds a valid .docx buffer from rich HTML (or plain text if no HTML tags are present). */
export function buildDocx(input: string): Buffer {
  const isHtml = /<(?:p|div|h[1-3]|ul|ol|li|blockquote|b|strong|i|em|u|s|strike|del|br)\b/i.test(input);
  const html = isHtml ? input : plainTextToHtml(input);
  const specs = htmlToParagraphSpecs(html);

  const body = specs
    .map((p) => {
      const pPrParts: string[] = [];
      if (p.style) pPrParts.push(`<w:pStyle w:val="${p.style}"/>`);
      if (p.list) {
        pPrParts.push(`<w:numPr><w:ilvl w:val="${p.list.ilvl}"/><w:numId w:val="${p.list.numId}"/></w:numPr>`);
      }
      const pPr = pPrParts.length ? `<w:pPr>${pPrParts.join('')}</w:pPr>` : '';
      const runs = inlineHtmlToWordRuns(p.inlineHtml);
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join('');

  const levelsXml = (bullet: boolean) =>
    [0, 1, 2, 3]
      .map(
        (lvl) =>
          `<w:lvl w:ilvl="${lvl}">` +
          '<w:start w:val="1"/>' +
          `<w:numFmt w:val="${bullet ? 'bullet' : 'decimal'}"/>` +
          `<w:lvlText w:val="${bullet ? '•' : `%${lvl + 1}.`}"/>` +
          `<w:pPr><w:ind w:left="${720 * (lvl + 1)}" w:hanging="360"/></w:pPr>` +
          '</w:lvl>',
      )
      .join('');

  const files: { name: string; content: string }[] = [
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/_rels/document.xml.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/styles.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="Heading 3"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>' +
        '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
        '</w:styles>',
    },
    {
      name: 'word/numbering.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:abstractNum w:abstractNumId="0">${levelsXml(true)}</w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1">${levelsXml(false)}</w:abstractNum>` +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
        '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
        '</w:numbering>',
    },
    {
      name: 'word/document.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}<w:sectPr/></w:body>` +
        '</w:document>',
    },
  ];

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.content, 'utf8');
    const comp = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);

    const local = Buffer.alloc(30 + nameBuf.length + comp.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    comp.copy(local, 30 + nameBuf.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, eocd]);
}

export async function readScript(piece: string): Promise<ScriptFile> {
  const dir = pieceFolder(piece);
  const found = findScriptFile(dir);
  if (!found) {
    const name = defaultScriptName(dir);
    return { name, path: rel(path.join(dir, name)), exists: false, html: '', text: '' };
  }
  readable(found);
  if (/\.docx$/i.test(found)) {
    const html = (await mammoth.convertToHtml({ path: found }, { styleMap: MAMMOTH_STYLE_MAP })).value;
    const text = htmlToPlainText(html);
    return { name: path.basename(found), path: rel(found), exists: true, html, text };
  }
  const raw = readText(found).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const html = plainTextToHtml(raw);
  return { name: path.basename(found), path: rel(found), exists: true, html, text: raw };
}

export async function saveScript(piece: string, content: string | { html?: string; text?: string }): Promise<ScriptFile> {
  const dir = pieceFolder(piece);
  const found = findScriptFile(dir);
  const target = found && /\.docx$/i.test(found) ? found : path.join(dir, defaultScriptName(dir));
  const input = typeof content === 'string' ? content : String(content?.html ?? content?.text ?? '');
  writeFile(target, buildDocx(input));
  return readScript(piece);
}
