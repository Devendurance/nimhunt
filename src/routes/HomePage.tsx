import { useRef } from 'react'
import { MarketingNav } from '../components/marketing/MarketingNav'
import { HeroSection } from '../components/marketing/HeroSection'
import { LandingHuntStatus } from '../components/marketing/LandingHuntStatus'
import { MissionsSection } from '../components/marketing/MissionsSection'
import { HowItWorksSection } from '../components/marketing/HowItWorksSection'
import { WorldsSection } from '../components/marketing/WorldsSection'
import { CharactersSection } from '../components/marketing/CharactersSection'
import { SealSection } from '../components/marketing/SealSection'
import { HallOfHeroesLive } from '../components/marketing/HallOfHeroesLive'
import { FinalCTASection } from '../components/marketing/FinalCTASection'
import { MarketingFooter } from '../components/marketing/MarketingFooter'
export function HomePage() {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const onHunt = (nextTrigger?: HTMLElement) => { trigger.current = nextTrigger ?? document.activeElement as HTMLElement; dialog.current?.showModal() }
  const restoreFocus = () => { trigger.current?.focus(); trigger.current = null }
  return <div id="top"><a className="skip-link" href="#main">Skip to content</a><MarketingNav onHunt={onHunt} /><main id="main"><HeroSection onHunt={onHunt} /><LandingHuntStatus /><MissionsSection /><HowItWorksSection /><WorldsSection onHunt={onHunt} /><CharactersSection /><SealSection /><HallOfHeroesLive /><FinalCTASection onHunt={onHunt} /></main><MarketingFooter /><dialog ref={dialog} onClose={restoreFocus} aria-labelledby="launch-heading" aria-describedby="launch-description"><span className="section-label">The expedition is taking shape</span><h2 id="launch-heading">See you in Nimiq Pay.</h2><p id="launch-description">NimHunt is coming to Nimiq Pay. The launch link isn’t available yet. Explore the missions and meet the ruins while we get the gates ready.</p><form method="dialog"><button className="button primary" autoFocus>Keep exploring</button></form></dialog></div>
}
