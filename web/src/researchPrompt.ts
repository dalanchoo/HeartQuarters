// The question John pastes into vidIQ and YouTube's Ask Studio before writing a brief, and how their answers reach
// the AIs. Neither tool can be asked from HeartQuarters (no way in without their own apps), so this makes the copy and
// paste quick: the question is filled in from YouTube.md, and each answer has its own box.

export interface ResearchFacts {
  /** The video's current title, from YouTube.md (may be empty). */
  title: string;
  /** The first paragraph of its description, as a hint of what it's about (may be empty). */
  about: string;
  short: boolean;
  /** The YouTube address when it's already on YouTube. */
  url?: string;
}

/** The question for vidIQ and Ask Studio: what the video is, then what to suggest and how, honest to the video. */
export function researchQuestion(f: ResearchFacts): string {
  const kind = f.short ? 'YouTube Short' : 'YouTube video';
  const name = f.title.trim() ? `my ${kind} "${f.title.trim()}"` : `my next ${kind}`;
  const where = f.url ? `, which is on my channel at ${f.url}` : ", which isn't on YouTube yet";
  return [
    `I'm choosing the title and ${f.short ? 'cover' : 'thumbnail'} for ${name}${where}.`,
    ...(f.about.trim() ? [`What it's about: ${f.about.trim()}`] : []),
    '',
    `Based on everything you know about this ${f.short ? 'Short' : 'video'}, my channel and its audience, and what works on YouTube right now, suggest 5 title and ${f.short ? 'cover' : 'thumbnail'} pairs. For each pair:`,
    `- the title${f.short ? ' (short, plain words that make sense in the Shorts feed)' : ' (under about 60 characters)'};`,
    '- the text on the image, 2 to 4 words, adding to the title rather than repeating it;',
    '- what the image shows: my expression and anything around me;',
    "- why someone who doesn't know me would click, and what backs that up (search terms, or similar videos that did well).",
    '',
    'Then say which pair you would choose and why. Suggest a description, comma-separated tags, hashtags, and a pinned comment. For longform, suggest chapters only if you have reliable timestamps; otherwise say you cannot determine them. Every suggestion must be true to what actually happens in the video; do not invent details or timestamps.',
  ].join('\n');
}

/** John's notes and the two tools' answers, as one text for the AIs, each under its own heading. Empty parts are left out. */
export function combineNotes(notes: string, vidiq: string, studio: string): string {
  return [
    notes.trim() && `John's notes:\n${notes.trim()}`,
    vidiq.trim() && `Research from vidIQ:\n${vidiq.trim()}`,
    studio.trim() && `Research from YouTube's Ask Studio:\n${studio.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
