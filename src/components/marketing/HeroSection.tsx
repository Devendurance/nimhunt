import { environmentAssets } from '../../data/assets'
import { HeroExplorerAsset, HeroGoblinAsset, HeroGolemAsset, HeroNimTreasureAsset } from './Assets'
import { HuntCTA, type HuntAction } from './HuntCTA'
export function HeroSection({ onHunt }: { onHunt: HuntAction }) {
  return <section className="hero-section" aria-labelledby="hero-heading">
    <div className="hero-stage" aria-hidden="true">
      <img className="hero-environment" src={environmentAssets.scenery} alt="" width="1672" height="941" fetchPriority="high" />
      <div className="hero-vignette" />
      <div className="hero-golem"><HeroGolemAsset /></div>
      <div className="hero-explorer"><HeroExplorerAsset /></div>
      <div className="hero-goblin"><HeroGoblinAsset /></div>
      <div className="hero-treasure"><HeroNimTreasureAsset /></div>
    </div>
    <div className="hero-copy"><h1 id="hero-heading">Explore the ruins.<br />Seal the treasure.</h1>
      <p>A daily skill adventure inside Nimiq Pay. Complete your mission, survive Angkor Ruins, and seal an available NIM reward before the day's treasures are gone.</p>
      <div className="hero-actions"><HuntCTA onUnavailable={onHunt} /><a className="text-link" href="#missions">See today's missions <span aria-hidden="true">↘</span></a></div>
      <span className="microcopy">skill task first · wallet seal last</span>
    </div>
  </section>
}
