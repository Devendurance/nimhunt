import { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { NimiqDevPanel } from '../components/play/NimiqDevPanel'
import { PlayShell } from '../components/play/PlayShell'

const GameDevView = lazy(() =>
  import('../components/play/GameDevView').then(m => ({ default: m.GameDevView }))
)

export function PlayPage() {
  const [params] = useSearchParams()
  if (params.get('dev') === 'nimiq') return <NimiqDevPanel />
  if (params.get('dev') === 'game') {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#132a26' }} />}>
        <GameDevView />
      </Suspense>
    )
  }
  return <NormalPlay />
}

function NormalPlay() {
  const location = useLocation()
  const navigate = useNavigate()
  const [initialTab] = useState<'hunt' | 'missions'>(() => location.state?.initialTab === 'missions' ? 'missions' : 'hunt')
  useEffect(() => {
    if (location.state?.initialTab === 'missions') navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location, navigate])
  return <PlayShell initialTab={initialTab} />
}
