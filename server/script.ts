// Reading and editing a video's or standalone Short's script (.docx, or an existing .md/.txt script) directly inside
// HeartQuarters. Saving writes a real Word (.docx) document so it still opens in Google Docs and Word on Google Drive.
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
  /** Plain-text contents (with "- " for bullet points). */
  text: string;
}

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

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
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

/** Extracts an entry by name from a ZIP buffer, or null if not a valid ZIP / entry not found. */
function readZipEntry(zip: Buffer, entryName: string): string | null {
  // Walk Central Directory via End of Central Directory (EOCD) record.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const cdCount = zip.readUInt16LE(eocd + 10);
  let ptr = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < cdCount && ptr + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = zip.readUInt16LE(ptr + 10);
    const compSize = zip.readUInt32LE(ptr + 20);
    const nameLen = zip.readUInt16LE(ptr + 28);
    const extraLen = zip.readUInt16LE(ptr + 30);
    const commentLen = zip.readUInt16LE(ptr + 32);
    const localOffset = zip.readUInt32LE(ptr + 42);
    const name = zip.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    ptr += 46 + nameLen + extraLen + commentLen;
    if (name !== entryName) continue;
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const comp = zip.subarray(dataStart, dataStart + compSize);
    if (method === 0) return comp.toString('utf8');
    if (method === 8) return zlib.inflateRawSync(comp).toString('utf8');
    return null;
  }
  return null;
}

/** Converts word/document.xml into plain text with "- " prefixes on bulleted paragraphs. */
function documentXmlToText(xml: string): string {
  const paragraphs: string[] = [];
  const pRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:p\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(xml)) !== null) {
    const inner = m[1] ?? '';
    const isList = /<w:numPr\b/.test(inner) || /<w:pStyle\b[^>]*w:val="List/i.test(inner);
    let line = '';
    const tokenRe = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^/]*\/>|<w:br\b[^/]*\/>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(inner)) !== null) {
      if (tm[1] !== undefined) line += decodeXml(tm[1]);
      else if (tm[0].startsWith('<w:tab')) line += '\t';
      else line += '\n';
    }
    if (isList && line.trim() && !/^\s*[-*•]\s+/.test(line)) {
      paragraphs.push(`- ${line}`);
    } else {
      paragraphs.push(line);
    }
  }
  return paragraphs.join('\n');
}

async function readDocxText(full: string): Promise<string> {
  readable(full);
  const buf = fs.readFileSync(full);
  try {
    const xml = readZipEntry(buf, 'word/document.xml');
    if (xml !== null) return documentXmlToText(xml);
  } catch {
    // Fall back to mammoth below.
  }
  return (await mammoth.extractRawText({ path: full })).value.replace(/\r\n/g, '\n');
}

/** Builds a valid .docx buffer from plain text (lines starting with "- ", "* ", or "• " become Word bullet items). */
export function buildDocx(text: string): Buffer {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const body = lines
    .map((raw) => {
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
      const content = bullet ? bullet[1] : raw;
      const pPr = bullet ? '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' : '';
      const run = content ? `<w:r><w:t xml:space="preserve">${encodeXml(content)}</w:t></w:r>` : '';
      return `<w:p>${pPr}${run}</w:p>`;
    })
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
        '</Relationships>',
    },
    {
      name: 'word/numbering.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:abstractNum w:abstractNumId="0">' +
        '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>' +
        '</w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
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
    return { name, path: rel(path.join(dir, name)), exists: false, text: '' };
  }
  const text = /\.docx$/i.test(found) ? await readDocxText(found) : readText(found).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  return { name: path.basename(found), path: rel(found), exists: true, text };
}

export async function saveScript(piece: string, text: string): Promise<ScriptFile> {
  const dir = pieceFolder(piece);
  const found = findScriptFile(dir);
  const target = found && /\.docx$/i.test(found) ? found : path.join(dir, defaultScriptName(dir));
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  writeFile(target, buildDocx(normalized));
  return readScript(piece);
}
