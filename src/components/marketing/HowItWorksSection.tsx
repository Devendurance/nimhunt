import { adventureSteps } from '../../data/marketing'
export function HowItWorksSection() {
  return <section className="section journey-section" aria-labelledby="journey-heading"><span className="section-label">The expedition loop</span><h2 id="journey-heading">Explore. Survive. Seal.</h2><ol className="journey">{adventureSteps.map((step, index) => <li key={step.name}><span className="route-node">0{index + 1}</span><h3>{step.name}</h3><p>{step.text}</p></li>)}</ol></section>
}
