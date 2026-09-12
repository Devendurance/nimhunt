import { lazy, Suspense } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { NimiqDevPanel } from '../components/play/NimiqDevPanel'
import { PlayShell } from '../components/play/PlayShell'
import { ProductExpeditionGate } from '../components/play/ProductExpeditionGate'
import { resolvePlayRoute } from '../components/play/expeditionFlow'
import { clearRememberedProductTerminal } from '../components/play/productRunSession.ts'

const GameDevView = lazy(() =>
  import('../components/play/GameDevView').then(m => ({ default: m.GameDevView }))
)

const ExpeditionView = lazy(() =>
  import('../components/play/ExpeditionView').then(m => ({ default: m.ExpeditionView }))
)

export function PlayPage() {
  const [params] = useSearchParams()
  const route = resolvePlayRoute({ dev: params.get('dev'), run: params.get('run'), runId: params.get('runId'), practice: params.get('practice'), mission: params.get('mission') })
  const navigate = useNavigate()
  const leaveTo = (tab: 'missions' | 'hunt') => {
    clearRememberedProductTerminal()
    navigate('/play', { state: { initialTab: tab } })
  }

  if (route.view === 'nimiq') return <NimiqDevPanel />
  if (route.view === 'dev-game') {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#132a26' }} />}>
        <GameDevView />
      </Suspense>
    )
  }
  if (route.view === 'product-expedition') {
    const mission = route.mission
    // Navigating to plain /play unmounts the run view, whose cleanup destroys the Phaser instance.
    const backToMissions = () => leaveTo('missions')
    const returnToHunt = () => leaveTo('hunt')
    return <ProductExpeditionGate mission={mission} runId={route.runId} onBackToMissions={backToMissions} onReturnToHunt={returnToHunt}>
      {active => <Suspense fallback={<div style={{ minHeight: '100vh', background: '#132a26' }} />}>
        <ExpeditionView key={`${mission}:${route.runId}`} mode="product" active={active} mission={mission} onBackToMissions={backToMissions} onReturnToHunt={returnToHunt} />
      </Suspense>}
    </ProductExpeditionGate>
  }
  if (route.view === 'practice') {
    const mission = route.mission
    const backToMissions = () => leaveTo('missions')
    const returnToHunt = () => leaveTo('hunt')
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#132a26' }} />}>
        <ExpeditionView key={`practice:${mission}`} mode="practice" mission={mission} onBackToMissions={backToMissions} onReturnToHunt={returnToHunt} />
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
    if (location.state?.initialTab === 'missions' || location.state?.initialTab === 'hunt') navigate(location.pathname + location.search, { replace: true, state: null })
  }, [location, navigate])
  return <PlayShell initialTab={initialTab} />
}
