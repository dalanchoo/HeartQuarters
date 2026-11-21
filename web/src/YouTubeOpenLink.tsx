/** Compact links used where the full YouTube labels crowd other controls. */
export function YouTubeOpenLink({ href, studio = false }: { href: string; studio?: boolean }) {
  const label = studio ? 'Open in YouTube Studio' : 'Open in YouTube';
  return <a className="button-link small youtube-open-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {studio ? <path fill="#e62117" d="M12 1.5 20.5 6.5v11L12 22.5 3.5 17.5v-11z" /> : <rect fill="#e62117" x="1" y="4" width="22" height="16" rx="5" />}
      <path fill="white" d="m10 8 6 4-6 4z" />
    </svg>
    <span aria-hidden="true">↗</span>
  </a>;
}
