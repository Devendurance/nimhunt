import { useEffect, useState } from 'react'
export type LiveHuntStatusProps = { claimed: number; total: number; resetsAt?: Date; loading?: boolean; previewReset?: string; preview?: boolean }
export function LiveHuntStatus({ claimed, total, resetsAt, loading = false, previewReset, preview = false }: LiveHuntStatusProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!resetsAt || preview) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [resetsAt, preview])
  const seconds = resetsAt && !preview ? Math.max(0, Math.floor((resetsAt.getTime() - now) / 1000)) : undefined
  const countdown = seconds === undefined ? previewReset : [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
  const remaining = Math.max(0, total - claimed)
  const heading = preview ? 'Today’s hunt · preview' : loading ? "Checking today's hunt" : remaining ? "Today's hunt is live" : "Today's NIM treasures are sealed"
  return <section className="hunt-strip" aria-label={preview ? 'Hunt availability preview' : 'Hunt availability'} aria-busy={loading}>
    <div><span className="status-marker" aria-hidden="true" /><strong>{heading}</strong><small>{preview ? 'Sample data · not live' : 'Daily reward availability'}</small></div>
    <div className="remaining"><strong>{loading ? '—' : `${remaining} / ${total}`}</strong><span>treasures remain</span></div>
    <div className="reset"><span>reset in</span><strong>{loading ? '—' : countdown ?? 'Awaiting schedule'}</strong></div>
  </section>
}
