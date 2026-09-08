import { sealSteps } from '../../data/marketing'
import { CharacterAsset } from './Assets'
export function SealSection() {
  return <section className="section seal-section" aria-labelledby="seal-heading"><div className="seal-copy"><span className="section-label">04 / The final move is yours</span><h2 id="seal-heading">The seal is real.</h2><p>When you complete an eligible task, Nimiq Pay turns the final signature into the moment the treasure is sealed. The reward state and wallet confirmation make the outcome visible.</p><CharacterAsset character="treasure" /></div><div className="seal-process"><span className="section-label">The sealing journey · illustrated</span><ol>{sealSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}</ol><p className="fairness">Chest loot changes the adventure. Completing the mission is what makes a real NIM claim eligible.</p></div></section>
}
