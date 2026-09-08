import { huntLaunchConfig } from '../../data/marketing'
import { HuntCTA, type HuntAction } from './HuntCTA'
export function FinalCTASection({ onHunt }: { onHunt: HuntAction }) {
  return <section className="section final-cta" aria-labelledby="final-heading"><div><span className="campaign">Explore. Survive. Seal.</span><h2 id="final-heading">The next expedition<br />is waiting.</h2><HuntCTA onUnavailable={onHunt} /><p>Mobile-first. Three free reward-eligible expeditions each day. Skill task required.</p></div><div className="qr-placeholder">{huntLaunchConfig.kind === 'configured' && huntLaunchConfig.qrImage ? <img src={huntLaunchConfig.qrImage} alt="Scan to open NimHunt in Nimiq Pay" width="144" height="144" /> : <><span className="phone-outline" aria-hidden="true">◇</span><strong>Your adventure.<br />Inside Nimiq Pay.</strong><small>Scan-to-play arrives at launch.</small></>}</div></section>
}
