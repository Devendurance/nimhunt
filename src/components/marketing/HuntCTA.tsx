import { huntLaunchConfig } from '../../data/marketing'
import { detectNimiqPayHost } from '../../integrations/nimiq/nimiqClient'
import { resolveLandingHuntCta } from './landingHuntCta'
import { Icon } from './Icon'
export type HuntAction = (trigger?: HTMLElement) => void
export function HuntCTA({ onUnavailable, label }: { onUnavailable: HuntAction; label?: string }) {
  const cta = resolveLandingHuntCta({
    inNimiqPay: detectNimiqPayHost(),
    launchConfig: huntLaunchConfig,
    label,
  })
  if (cta.kind === 'in-app' || cta.kind === 'deep-link') {
    return <a className="button primary" href={cta.href}>{cta.label}<Icon name="arrow" /></a>
  }
  return <button className="button primary" type="button" onClick={event => onUnavailable(event.currentTarget)}>{cta.label}<Icon name="arrow" /></button>
}
