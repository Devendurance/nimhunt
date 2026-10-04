import './AngkorV2HealthMeter.css'
import { healthPresentation } from './healthPresentation'

export function AngkorV2HealthMeter({ hp }: { hp: number }) {
  const { value, tone, fills } = healthPresentation(hp)
  return <div className="v2-health" data-tone={tone} role="meter" aria-label={`Health ${hp} of 100`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <span className="v2-health-frame" aria-hidden="true">
      {fills.map((fill, index) => <span className="v2-health-segment" key={index}>
        <span className="v2-health-fill" style={{ width: `${fill * 100}%` }} />
      </span>)}
    </span>
    <span className="v2-health-number" aria-hidden="true">HP {hp}</span>
  </div>
}
