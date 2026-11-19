// Instant, local check for AI writing tells, Heart Mind Fusion tone rules (channel-basics),
// and statistical rhythm fingerprints (low burstiness / uniform sentence length).
export interface AiWritingTell {
  /** The exact matched word, phrase, or statistical observation. */
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
    re: /\bless\s+about\b[^.!?\n]{1,60}\band\s+more\s+about\b/gi,
    reason: 'Formulaic AI contrast ("less about X and more about Y")',
  },
  {
    re: /(?:^|[.!?]\s+)No\s+[^.!?\n]{2,35}[.,]\s*No\s+[^.!?\n]{2,35}[.,]\s*Just\b/gi,
    reason: 'Staccato AI negative parallelism ("No X. No Y. Just Z.")',
  },
  {
    re: /\bmore\s+than\s+just\b/gi,
    reason: 'Common AI contrast phrase ("more than just")',
  },
  {
    re: /\b(?:and\s+that['’]s\s+(?:the\s+real\s+lesson|why\s+it\s+matters|what\s+truly\s+matters)|because\s+ultimately,|ultimately,\s+(?:it['’]s|healing|growth|life|connection|what)|in\s+the\s+end,\s+it['’]s\s+not|is\s+a\s+reminder\s+that|serves\s+as\s+a\s+reminder|the\s+biggest\s+takeaway\s+is)\b/gi,
    reason: 'Moralizing AI takeaway or summary closer (let the story speak for itself)',
  },
  {
    re: /\b(?:here['’]s\s+(?:the\s+(?:thing|truth|kicker|catch)|what\s+nobody\s+tells\s+you)|the\s+(?:hard\s+|uncomfortable\s+)?truth\s+is|let\s+that\s+sink\s+in|read\s+that\s+again|spoiler\s+alert:|plot\s+twist:)\b/gi,
    reason: 'Dramatic AI transition or hook cliché',
  },
  {
    re: /\b(?:hold(?:ing)?\s+space\s+for|lean(?:ing)?\s+into\s+the\s+discomfort|sit(?:ting)?\s+with\s+the\s+(?:discomfort|uncertainty)|unapologetically|quiet\s+power\s+of|gentle\s+reminder|deeply\s+human|raw\s+and\s+honest|safe\s+space\s+to)\b/gi,
    reason: 'Polished AI therapy-speak phrase',
  },
  {
    re: /\b(?:delve|delves|delving|tapestry|testament\s+to|beacon\s+of|underscores|underpins|navigating\s+the|landscape\s+of|realm\s+of|foster|fostering|unpack|unpacking|nuance|nuanced|transformative|profoundly|resonates?\s+deeply|at\s+its\s+core|in\s+a\s+world\s+where|let['’]s\s+dive\s+in|without\s+further\s+ado|at\s+the\s+end\s+of\s+the\s+day|it['’]s\s+worth\s+noting|it\s+is\s+important\s+to\s+remember|embark\s+on\s+a\s+journey|newfound|stark\s+contrast|multifaceted|intricacies|pivotal\s+moment|paradigm\s+shift|catalyst\s+for)\b/gi,
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

/** Detects flat, overly uniform sentence length across 5+ consecutive sentences (low burstiness). */
function checkSentenceBurstiness(cleaned: string): AiWritingTell | null {
  const sentences = cleaned
    .split(/[.!?]+(?:\s+|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((count) => count >= 6);

  if (sentences.length < 5) return null;

  const windowSize = 5;
  for (let i = 0; i <= sentences.length - windowSize; i++) {
    const win = sentences.slice(i, i + windowSize);
    const mean = win.reduce((a, b) => a + b, 0) / windowSize;
    if (mean < 10) continue;
    const variance = win.reduce((acc, n) => acc + (n - mean) ** 2, 0) / windowSize;
    const cv = Math.sqrt(variance) / mean;
    if (cv < 0.14) {
      return {
        match: `5 sentences in a row have almost identical length (~${Math.round(mean)} words each)`,
        reason:
          'Flat sentence rhythm (low burstiness) is a statistical fingerprint of AI text — mix in a short 4–6 word sentence or split a medium one',
      };
    }
  }
  return null;
}

/** Finds common AI writing tells and statistical rhythm patterns in `text`, ignoring URLs and hashtag lines. */
export function findAiWritingTells(text: string): AiWritingTell[] {
  if (!text || !text.trim()) return [];
  const cleaned = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:^|\s)#[\p{L}\p{N}_]+/gu, ' ');

  const found: AiWritingTell[] = [];
  const seen = new Set<string>();

  const emDashes = (cleaned.match(/—/g) ?? []).length;
  if (emDashes > 0) {
    found.push({
      match: emDashes === 1 ? '—' : `${emDashes} em-dashes (—)`,
      reason: 'Em-dashes (—) are a frequent AI punctuation tell',
    });
  }

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

  const rhythm = checkSentenceBurstiness(cleaned);
  if (rhythm) found.push(rhythm);

  return found;
}
