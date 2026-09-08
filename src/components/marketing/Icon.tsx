export function Icon({ name }: { name: 'gem' | 'chest' | 'key' | 'lock' | 'arrow' }) {
  const paths = {
    gem: <path d="m3 9 5-6h8l5 6-9 12L3 9Z M3 9h18 M8 3l4 18 4-18" />,
    chest: <><path d="M3 11V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v14H3V11Zm0 0h18 M8 3v8m8-8v8" /><path d="M10 10h4v5h-4z" /></>,
    key: <><circle cx="8" cy="8" r="5" /><path d="m12 12 9 9m-5-5 3-3m-1 5 3-3" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
