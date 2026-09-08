import { environmentAssets } from '../../data/assets'
import { HuntCTA, type HuntAction } from './HuntCTA'
import { Icon } from './Icon'
export function WorldsSection({ onHunt }: { onHunt: HuntAction }) {
  return <section className="section worlds-section" id="world" aria-labelledby="world-heading"><div className="section-heading"><div><span className="section-label">02 / Beyond the gate</span><h2 id="world-heading">One ruin first.<br />More worlds ahead.</h2></div><p>Ancient paths. Hidden chambers.<br />Your route is yours.</p></div>
    <article className="world-feature"><img src={environmentAssets.world} alt="Sunlit sandstone temples, giant roots and waterfalls in the Angkor jungle" width="1672" height="941" loading="lazy" /><div className="world-caption"><span className="section-label">World 01</span><h3>Angkor Ruins</h3><HuntCTA label="Hunt in Nimiq Pay" onUnavailable={onHunt} /><small>Inside Nimiq Pay · launch link coming soon</small></div></article>
    <div className="locked-worlds">{['Bavaria', 'Siberia'].map((name, index) => <article key={name}><span className="world-number">0{index + 2}</span><div><h3>{name}</h3><span>Coming soon</span></div><Icon name="lock" /></article>)}</div>
  </section>
}
