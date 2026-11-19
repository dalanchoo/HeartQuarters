/** Split Markdown level-two/three sections without changing older unstructured summaries. */
export function analyticsSummarySections(markdown: string): { title: string; body: string }[] {
  const sections: { title: string; body: string }[] = [];
  let title = ''; let lines: string[] = [];
  const flush = () => { const body = lines.join('\n').trim(); if (title || body) sections.push({ title, body }); };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { flush(); title = heading[1]; lines = []; } else lines.push(line);
  }
  flush(); return sections;
}
