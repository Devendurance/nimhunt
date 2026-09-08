import { missionPreviews } from '../../data/marketing'
import { Icon } from './Icon'
export function MissionsSection() {
  return <section className="section" id="missions" aria-labelledby="missions-heading">
    <div className="section-heading"><div><span className="section-label">01 / Today's missions</span><h2 id="missions-heading">Every run starts<br />with a mission.</h2></div><p>Collect gems, hunt chests, recover relics, or break into the Temple Vault. The task is visible before you move.</p></div>
    <div className="mission-grid">{missionPreviews.map((mission, index) => <article className="mission" key={mission.name}><div className="mission-top"><span>Expedition brief / 0{index + 1}</span><Icon name={mission.icon} /></div><h3>{mission.name}</h3><p>{mission.objective}</p><div className="mission-bottom"><span>Skill task</span><span>Finish alive</span></div></article>)}</div>
    <p className="footnote">Illustrative missions. Your expedition begins inside Nimiq Pay.</p>
  </section>
}
