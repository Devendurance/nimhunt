import { LiveHuntStatus } from './LiveHuntStatus'
import { useLandingHuntStatus } from './useLandingHuntStatus'

export function LandingHuntStatus() {
  const status = useLandingHuntStatus()

  if (status.kind === 'loading') {
    return (
      <section className="hunt-strip" aria-label="Hunt availability" aria-busy>
        <div>
          <span className="status-marker" aria-hidden="true" />
          <strong>Checking today&apos;s hunt</strong>
          <small>Daily reward availability</small>
        </div>
        <div className="remaining">
          <strong>—</strong>
          <span>treasures remain</span>
        </div>
        <div className="reset">
          <span>reset in</span>
          <strong>—</strong>
        </div>
      </section>
    )
  }

  if (status.kind === 'unavailable') {
    return (
      <section className="hunt-strip" aria-label="Hunt availability" aria-busy={false}>
        <div>
          <span className="status-marker" aria-hidden="true" />
          <strong>Today&apos;s hunt · unavailable</strong>
          <small>Daily reward availability</small>
        </div>
        <div className="remaining">
          <strong>—</strong>
          <span>treasures remain</span>
        </div>
        <div className="reset">
          <span>reset in</span>
          <strong>—</strong>
        </div>
      </section>
    )
  }

  const claimed = Math.max(0, status.totalSlots - status.remainingSlots)
  const resetsAt = new Date(status.nextResetAt)
  return (
    <LiveHuntStatus
      claimed={claimed}
      total={status.totalSlots}
      resetsAt={Number.isNaN(resetsAt.getTime()) ? undefined : resetsAt}
    />
  )
}
