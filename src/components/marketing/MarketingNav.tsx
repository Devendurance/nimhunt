import { useRef, useState } from 'react'
import { brandAssets } from '../../data/assets'
import { HuntCTA, type HuntAction } from './HuntCTA'
export function MarketingNav({ onHunt }: { onHunt: HuntAction }) {
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null)
  return <header className="site-header" onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus() } }}>
    <a className="site-wordmark" href="#top" aria-label="NimHunt home"><img src={brandAssets.wordmark} alt="" width={160} height={34} decoding="async" /></a>
    <nav id="marketing-navigation" className={open ? 'navigation open' : 'navigation'} aria-label="Main navigation">
      {[['Missions', 'missions'], ['World', 'world'], ['Heroes', 'heroes']].map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{label}</a>)}
    </nav>
    <HuntCTA onUnavailable={trigger => { setOpen(false); onHunt(trigger) }} />
    <button ref={toggle} className="menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="marketing-navigation" onClick={() => setOpen(!open)}>{open ? '×' : '☰'}</button>
  </header>
}
