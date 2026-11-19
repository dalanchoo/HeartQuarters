// Instant, local check for common AI writing tells and Heart Mind Fusion tone rules (channel-basics).
export interface AiWritingTell {
  /** The exact matched word or phrase from the text. */
  match: string;
  /** Plain-English explanation of why it sounds like AI. */
  reason: string;
}

const RULES: { re: RegExp; reason: string }[] = [
  {
    re: /\b(?:it['’]s|is|was|isn['’]t|wasn['’]t|not)\s+(?:just|merely|simply|only)\b[^.!?\n]{1,60}\b(?:it['’]s|it\s+is|it\s+was|but\s+rather)\b/gi,
    reason: 'Formulaic AI contrast ("not just X, it’s Y")',
  },
  {
    re: /\bnot\s+about\b[^.!?\n]{1,60}\bit['’]s\s+about\b/gi,
    reason: 'Formulaic AI contrast ("not about X, it’s about Y")',
  },
  {
    re: /\bmore\s+than\s+just\b/gi,
    reason: 'Common AI contrast phrase ("more than just")',
  },
  {
    re: /—/g,
    reason: 'Em-dash (—) is a frequent AI punctuation tell',
  },
  {
    re: /\b(?:delve|delves|delving|tapestry|testament\s+to|beacon\s+of|underscores|underpins|navigating\s+the|landscape\s+of|realm\s+of|foster|fostering|unpack|unpacking|nuance|nuanced|transformative|profoundly|resonates?\s+deeply|at\s+its\s+core|in\s+a\s+world\s+where|let['’]s\s+dive\s+in|without\s+further\s+ado|here['’]s\s+the\s+thing|the\s+truth\s+is|at\s+the\s+end\s+of\s+the\s+day|it['’]s\s+worth\s+noting|it\s+is\s+important\s+to\s+remember|embark\s+on\s+a\s+journey|newfound)\b/gi,
    reason: 'Common AI cliché or filler phrase',
  },
  {
    re: /\b(?:whether\s+you['’]re\b[^.!?\n]{1,60}\bor\b)/gi,
    reason: 'Formulaic AI framing ("Whether you’re X or Y")',
  },
  {
    re: /\b(?:insane|incredible|mind-blowing|game-?changer|this\s+changed\s+everything)\b/gi,
    reason: 'Hype language (Heart Mind Fusion tone is calm, honest, and personal)',
  },
  {
    re: /\bthink\s+deeply,\s*feel\s+fully\b/gi,
    reason: 'Avoid the old tagline unless explicitly wanted',
  },
];

/** Label names for technical fields that shouldn't show the prose AI-writing checker. */
export function isProseFieldLabel(label: string): boolean {
  return !/^(?:tags|hashtags|video\s+language|made\s+for\s+kids|altered\s+content|category|privacy|visibility|playlist|playlists)$/i.test(
    label.trim(),
  );
}

/** Finds common AI writing tells in `text`, ignoring URLs and hashtag lines. */
export function findAiWritingTells(text: string): AiWritingTell[] {
  if (!text || !text.trim()) return [];
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, ' ');

  const found: AiWritingTell[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(cleaned)) !== null) {
      const match = m[0].trim();
      const key = `${match.toLowerCase()}|${rule.reason}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ match, reason: rule.reason });
      }
    }
  }
  return found;
}
