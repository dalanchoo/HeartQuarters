/** Strip only known sharing/marketing parameters from recognized YouTube links. */
export function cleanYoutubeLinks(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
    // Keep ordinary sentence and Markdown punctuation outside the address.
    const suffix = candidate.match(/[.,;!?)]+$/)?.[0] ?? '';
    const address = suffix ? candidate.slice(0, -suffix.length) : candidate;
    let url: URL;
    try { url = new URL(address); } catch { return candidate; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return candidate;
    const host = url.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return candidate;
    const parts = url.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be' && parts.length === 1 ? parts[0]
      : parts.length === 1 && parts[0] === 'watch' ? url.searchParams.get('v')
      : parts.length === 2 && ['shorts', 'live'].includes(parts[0]) ? parts[1] : null;
    const playlist = host !== 'youtu.be' && parts.length === 1 && parts[0] === 'playlist' && /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('list') ?? '');
    if ((!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) && !playlist) return candidate;
    if (!url.search) return candidate;
    const question = address.indexOf('?'); const hash = address.indexOf('#', question);
    const prefix = address.slice(0, question); const fragment = hash < 0 ? '' : address.slice(hash);
    const raw = address.slice(question + 1, hash < 0 ? undefined : hash);
    const kept = raw.split('&').filter((parameter) => {
      const [keyRaw, ...valueRaw] = parameter.split('=');
      try {
        const key = decodeURIComponent(keyRaw.replace(/\+/g, ' ')).toLowerCase();
        const value = decodeURIComponent(valueRaw.join('=').replace(/\+/g, ' ')).toLowerCase();
        return !(key === 'si' || ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].includes(key) || (key === 'feature' && value === 'share'));
      } catch { return true; }
    });
    if (kept.length === raw.split('&').length) return candidate;
    return prefix + (kept.length && kept.some(Boolean) ? `?${kept.join('&')}` : '') + fragment + suffix;
  });
}
