import { huntLaunchConfig } from '../../data/marketing'
import { Icon } from './Icon'
export type HuntAction = (trigger?: HTMLElement) => void
export function HuntCTA({ onUnavailable, label = 'Hunt in Nimiq Pay' }: { onUnavailable: HuntAction; label?: string }) {
  return huntLaunchConfig.kind === 'configured'
    ? <a className="button primary" href={huntLaunchConfig.deepLink}>{label}<Icon name="arrow" /></a>
    : <button className="button primary" type="button" onClick={event => onUnavailable(event.currentTarget)}>{label}<Icon name="arrow" /></button>
}
