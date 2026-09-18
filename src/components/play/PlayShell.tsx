import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { playAssets } from '../../data/assets'
import { playMissions } from '../../data/play'
import type { Mission, MissionId, PlayTab } from '../../types/play'
import { isMissionLaunchable } from './expeditionFlow'
import { formatExpeditionsLeftToday } from './huntStatusView'
import { MonthlyHeroesBlock, YourMonthBlock } from './MonthlyHeroes'
import { HuntHeader } from './HuntHeader'
import { HuntStatus } from './HuntStatus'
import { MissionBrief } from './MissionBrief'
import { MissionList } from './MissionList'
import { PlayBottomNav } from './PlayBottomNav'
import { PLAY_WALLET_BOOTSTRAP_COPY } from './playWalletBootstrap'
import { ProgressStrip } from './ProgressStrip'
import { ProductPayoutStatusCard } from './ProductRewardClaimOutcome'
import { TreasureBankSection } from './TreasureBank'
import { useNimhuntBgm } from '../../audio/useNimhuntAudio'
import { useTreasureBank } from './useTreasureBank'
import { getRememberedProductWallet, rememberProductWallet } from './productWallet'
import { shortenNqWallet } from './productVaultSeal'
import { useDailyHuntStatus } from './useDailyHuntStatus'
import { usePlayRewardRecovery } from './usePlayRewardRecovery'
import { usePlayWalletBootstrap } from './usePlayWalletBootstrap'
import { useProductPayoutStatus } from './useProductPayoutStatus'
import { useProductStart } from './useProductStart'
import { WorldStatus } from './WorldStatus'
import {
  formatPlayRecoveryDevLine,
  getPlayRecoveryDiagnostics,
  isPlayRecoveryDevBannerEnabled,
  subscribePlayRecoveryDiagnostics,
  traceWalletRecovery,
} from './walletRecoveryDiagnostics'
import styles from './PlayShell.module.css'

export function PlayShell({ initialTab = 'hunt' }: { initialTab?: PlayTab }) {
  useNimhuntBgm('main', 'shell')
  const bootstrap = usePlayWalletBootstrap()
  const hunt = useDailyHuntStatus(bootstrap.wallet ?? getRememberedProductWallet())
  const [payoutUnauthorized, setPayoutUnauthorized] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const showRecoveryDiag = isPlayRecoveryDevBannerEnabled(searchParams)
  const [, setRecoveryDiagVersion] = useState(0)
  const recoveryDiag = showRecoveryDiag ? getPlayRecoveryDiagnostics() : null
  const recovery = usePlayRewardRecovery({
    enabled: bootstrap.status === 'CONNECTED' && payoutUnauthorized,
    wallet: bootstrap.wallet,
  })
  const payout = useProductPayoutStatus({
    enabled: true,
    claimId: null,
    recoverFromSession: true,
    unavailableAs: 'hidden',
    sessionKey: recovery.epoch,
    onUnavailable: code => {
      if (code === 'RUN_SESSION_INVALID') setPayoutUnauthorized(true)
    },
  })
  const treasureWalletConnected = bootstrap.status === 'CONNECTED' && Boolean(bootstrap.wallet)
  const treasure = useTreasureBank({
    enabled: treasureWalletConnected,
    sessionKey: recovery.epoch,
    onUnauthorized: () => setPayoutUnauthorized(true),
  })
  const expeditionsLeftToday = formatExpeditionsLeftToday(hunt.walletStatus)
  const [activeTab, setActiveTab] = useState<PlayTab>(initialTab)
  const [selectedMissionId, setSelectedMissionId] = useState<MissionId | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const startedRunRef = useRef<string | null>(null)
  const selectedMission = playMissions.find(mission => mission.id === selectedMissionId) ?? null

  const handleProductStarted = useCallback((start: { runId: string; blueprint: { mission: MissionId } }, normalizedWallet: string) => {
    if (startedRunRef.current === start.runId) return
    startedRunRef.current = start.runId
    rememberProductWallet(normalizedWallet)
    dialogRef.current?.close()
    setSelectedMissionId(null)
    setSearchParams({ run: start.blueprint.mission, runId: start.runId })
  }, [setSearchParams])
  const productStart = useProductStart({ onStarted: handleProductStarted })

  useEffect(() => {
    if (!showRecoveryDiag) return
    return subscribePlayRecoveryDiagnostics(() => setRecoveryDiagVersion(version => version + 1))
  }, [showRecoveryDiag])

  useEffect(() => {
    traceWalletRecovery('PAYOUT_CARD_RENDER', {
      render: payout ? 'yes' : 'no',
      status: payout?.status ?? 'none',
    })
  }, [payout])

  useEffect(() => {
    if (selectedMission && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }, [selectedMission])

  const openMission = (mission: Mission, button: HTMLButtonElement) => {
    trigger.current = button
    setSelectedMissionId(mission.id)
  }

  const closeSheet = () => dialogRef.current?.close()

  const handleClose = () => {
    setSelectedMissionId(null)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  const handleStartExpedition = (mission: Mission) => {
    if (!isMissionLaunchable(mission.id)) return
    void productStart.begin(mission.id)
  }

  const handleStartPractice = (mission: Mission) => {
    if (!isMissionLaunchable(mission.id)) return
    closeSheet()
    setSelectedMissionId(null)
    setSearchParams({ practice: mission.id })
  }

  return <div className={styles.shell}>
    <div className={styles.viewport}>
      {showRecoveryDiag && recoveryDiag && <p className={styles.devRecovery}>{formatPlayRecoveryDevLine(recoveryDiag)}</p>}
      <HuntHeader />
      <PlayWalletStrip bootstrap={bootstrap} recovering={recovery.status === 'signing'} />
      <main className={styles.main}>
        {activeTab === 'hunt' && <>
          <section className={styles.hero} aria-labelledby="play-heading">
            <div className={styles.heroCopy}><span className={styles.kicker}>NIMHUNT · DAILY EXPEDITION</span><h1 id="play-heading">Today's hunt</h1><p>Choose your task, enter the ruins, and make it out alive.</p></div>
            <div className={styles.heroScene}><img src={playAssets.angkor} alt="Angkor Ruins" width={1672} height={941} loading="eager" decoding="async" /><img className={styles.heroExplorer} src={playAssets.explorer} alt="" width={1280} height={1280} loading="eager" decoding="async" /><span className={styles.sceneTag}>ANGKOR RUINS · AVAILABLE</span></div>
          </section>
          <HuntStatus hunt={hunt} />
          {payout && <ProductPayoutStatusCard payout={payout} />}
          {treasureWalletConnected && <TreasureBankSection state={treasure} onRetry={treasure.retry} />}
          <MissionList missions={playMissions} onEnter={openMission} compact expeditionsLeftToday={expeditionsLeftToday} />
          <ProgressStrip />
          <WorldStatus />
        </>}
        {activeTab === 'missions' && <>
          <section className={styles.pageIntro} aria-labelledby="missions-page-heading"><span className={styles.kicker}>THE DAILY BOARD</span><h1 id="missions-page-heading">Today's missions</h1><p>Choose your route. The task is clear before the ruins open.</p></section>
          <HuntStatus hunt={hunt} />
          {payout && <ProductPayoutStatusCard payout={payout} />}
          {treasureWalletConnected && <TreasureBankSection state={treasure} onRetry={treasure.retry} />}
          <MissionList missions={playMissions} onEnter={openMission} expeditionsLeftToday={expeditionsLeftToday} />
          <WorldStatus />
        </>}
        {activeTab === 'heroes' && <>
          <section className={styles.pageIntro} aria-labelledby="heroes-page-heading"><span className={styles.kicker}>HALL OF HEROES</span><h1 id="heroes-page-heading">Hall of Heroes</h1><p>Live monthly standings from verified expeditions. Only proven runs count.</p></section>
          {treasureWalletConnected && <YourMonthBlock enabled sessionKey={recovery.epoch} onUnauthorized={() => setPayoutUnauthorized(true)} />}
          <MonthlyHeroesBlock selfWallet={treasureWalletConnected ? bootstrap.wallet : null} />
        </>}
      </main>
      <PlayBottomNav activeTab={activeTab} onChange={setActiveTab} />
      {selectedMission && <MissionBrief
        mission={selectedMission}
        dialogRef={dialogRef}
        onBack={closeSheet}
        onStartExpedition={handleStartExpedition}
        onClose={handleClose}
        productStart={productStart}
        onStartPractice={handleStartPractice}
        onFreshStart={productStart.reset}
      />}
      <div className={styles.footerMark}>Built for Nimiq Pay</div>
    </div>
  </div>
}

function PlayWalletStrip({
  bootstrap,
  recovering,
}: {
  readonly bootstrap: ReturnType<typeof usePlayWalletBootstrap>
  readonly recovering: boolean
}) {
  if (bootstrap.status === 'CONNECTING') {
    return <div className={styles.walletStrip} role="status">{PLAY_WALLET_BOOTSTRAP_COPY.CONNECTING}</div>
  }
  if (bootstrap.status === 'SELECTING_ACCOUNT') {
    return <div className={styles.walletStrip}>
      <p className={styles.walletCopy}>{PLAY_WALLET_BOOTSTRAP_COPY.SELECTING}</p>
      <div className={styles.accountList} role="group" aria-label="Nimiq accounts">
        {bootstrap.accounts.map(account => <button
          key={account}
          className={styles.accountButton}
          type="button"
          onClick={() => bootstrap.selectAccount(account)}
        >{shortenNqWallet(account)}</button>)}
      </div>
    </div>
  }
  if (bootstrap.status === 'CANCELLED') {
    return <div className={styles.walletStrip}>
      <p className={styles.walletCopy}>Account access was cancelled. Retry is safe.</p>
      <button className={styles.sheetPrimary} type="button" onClick={() => void bootstrap.connect()}>{PLAY_WALLET_BOOTSTRAP_COPY.CONNECT}</button>
    </div>
  }
  if (bootstrap.status === 'UNAVAILABLE' || bootstrap.status === 'IDLE') {
    return <div className={styles.walletStrip}>
      <p className={styles.walletCopy}>Open this hunt inside Nimiq Pay to connect your wallet.</p>
      <button className={styles.sheetPrimary} type="button" onClick={() => void bootstrap.connect()}>{PLAY_WALLET_BOOTSTRAP_COPY.CONNECT}</button>
    </div>
  }
  if (bootstrap.status === 'CONNECTED' && bootstrap.wallet) {
    return <div className={styles.walletStrip}>
      <span className={styles.walletIdentity}>{shortenNqWallet(bootstrap.wallet)}</span>
      {recovering && <span role="status">{PLAY_WALLET_BOOTSTRAP_COPY.RECOVERING}</span>}
    </div>
  }
  return null
}
