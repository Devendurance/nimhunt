import { useEffect, useState } from 'react'
export type LiveHuntStatusProps = { claimed: number; total: number; resetsAt?: Date; loading?: boolean }
export function LiveHuntStatus({ claimed, total, resetsAt, loading = false }: LiveHuntStatusProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!resetsAt) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [resetsAt])
  const seconds = resetsAt ? Math.max(0, Math.floor((resetsAt.getTime() - now) / 1000)) : undefined
  const countdown = seconds === undefined ? undefined : [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
  const remaining = Math.max(0, total - claimed)
  const heading = loading ? "Checking today's hunt" : remaining ? "Today's hunt is live" : "SOLD OUT — resets at UTC midnight"
  return <section className="hunt-strip" aria-label="Hunt availability" aria-busy={loading}>
    <div><span className="status-marker" aria-hidden="true" /><strong>{heading}</strong><small>{total === 7 ? '7 treasures. 1,000 NIM each. First come, first served.' : 'Daily reward availability · first come, first served'}</small></div>
    <div className="remaining"><strong>{loading ? '—' : `${remaining} / ${total}`}</strong><span>treasures remain</span></div>
    <div className="reset"><span>reset in</span><strong>{loading ? '—' : countdown ?? 'Awaiting schedule'}</strong></div>
  </section>
}
