import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { playAssets } from '../../data/assets'
import { playMissions } from '../../data/play'
import type { Mission, MissionId, PlayTab } from '../../types/play'
import { normalizePlayTabParams, resolvePlayTab, withPlayTab } from './playTab'
import { isMissionLaunchable } from './expeditionFlow'
import { formatExpeditionsLeftToday } from './huntStatusView'
import { MonthlyHeroesBlock, YourMonthBlock } from './MonthlyHeroes'
import { HuntHeader } from './HuntHeader'
import { HuntStatus } from './HuntStatus'
import { AdventurerOnboarding } from './AdventurerOnboarding'
import { AdventurerIdentityStatus } from './AdventurerIdentityStatus'
import { AdventurerProfilePanel } from './AdventurerProfilePanel'
import { AdventurerEditProfilePanel } from './AdventurerEditProfilePanel'
import { AdventurerSettingsPanel } from './AdventurerSettingsPanel'
import { BlockedAdventurersPanel } from './BlockedAdventurersPanel'
import { AlliesPanel } from './AlliesPanel'
import { PublicAdventurerProfileSheet } from './PublicAdventurerProfileSheet'
import { useAdventurer } from './useAdventurer'
import { resolveAdventurerIdentityPanel, resolveRealExpeditionGate } from './adventurerState'
import { REAL_EXPEDITION_PROFILE_GATE_ENABLED } from './adventurerAssets'
import { MissionBrief } from './MissionBrief'
import { MissionList } from './MissionList'
import { PlayBottomNav } from './PlayBottomNav'
import { PLAY_WALLET_BOOTSTRAP_COPY } from './playWalletBootstrap'
import { ProgressStrip } from './ProgressStrip'
import { ProductPayoutStatusCard } from './ProductRewardClaimOutcome'
import { TreasureBankCta, TreasureBankSection } from './TreasureBank'
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
  const adventurer = useAdventurer({ wallet: bootstrap.wallet, signMessage: bootstrap.signMessage })
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
  const requestedTab = searchParams.get('tab')
  const activeTab: PlayTab = resolvePlayTab(requestedTab, initialTab)
  const [selectedMissionId, setSelectedMissionId] = useState<MissionId | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const profileDialogRef = useRef<HTMLDialogElement>(null)
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const publicProfileDialogRef = useRef<HTMLDialogElement>(null)
  const publicProfileTriggerRef = useRef<HTMLButtonElement | null>(null)
  const startedRunRef = useRef<string | null>(null)
  const [profileDialogMode, setProfileDialogMode] = useState<'onboarding' | 'profile' | 'edit-profile' | 'allies' | 'settings' | 'blocked'>('onboarding')
  const [publicProfilePlayerId, setPublicProfilePlayerId] = useState<string | null>(null)
  const [socialRevision, setSocialRevision] = useState(0)
  const selectedMission = playMissions.find(mission => mission.id === selectedMissionId) ?? null
  const identityPanel = resolveAdventurerIdentityPanel(adventurer.status, Boolean(adventurer.profile))

  const openProfileDialog = useCallback((mode: 'onboarding' | 'profile' | 'edit-profile' | 'allies' | 'settings' | 'blocked', trigger?: HTMLButtonElement) => {
    profileTriggerRef.current = trigger ?? null
    setProfileDialogMode(mode)
    if (profileDialogRef.current && !profileDialogRef.current.open) profileDialogRef.current.showModal()
  }, [setProfileDialogMode])

  const closeProfileDialog = useCallback(() => {
    profileDialogRef.current?.close()
    requestAnimationFrame(() => profileTriggerRef.current?.focus())
  }, [])

  const openAllies = useCallback(() => {
    setProfileDialogMode('allies')
    if (profileDialogRef.current && !profileDialogRef.current.open) profileDialogRef.current.showModal()
  }, [setProfileDialogMode])

  const changeTab = useCallback((tab: PlayTab) => {
    setSearchParams(current => {
      return withPlayTab(current, tab)
    })
  }, [setSearchParams])

  const openPublicProfileDialog = useCallback((playerId: string, trigger: HTMLButtonElement) => {
    publicProfileTriggerRef.current = trigger
    setPublicProfilePlayerId(playerId)
  }, [setPublicProfilePlayerId])

  const closePublicProfileDialog = useCallback(() => {
    publicProfileDialogRef.current?.close()
  }, [])

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
    const next = normalizePlayTabParams(searchParams, initialTab)
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [initialTab, searchParams, setSearchParams])

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

  useEffect(() => {
    if (publicProfilePlayerId && publicProfileDialogRef.current && !publicProfileDialogRef.current.open) {
      publicProfileDialogRef.current.showModal()
    }
  }, [publicProfilePlayerId])

  useEffect(() => {
    if (adventurer.status === 'NEEDS_PROFILE' && !profileDialogRef.current?.open) {
      setProfileDialogMode('onboarding')
      profileDialogRef.current?.showModal()
    }
  }, [adventurer.status])

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
    const gateDecision = resolveRealExpeditionGate({
      enabled: REAL_EXPEDITION_PROFILE_GATE_ENABLED,
      wallet: bootstrap.wallet,
      adventurerStatus: adventurer.status,
    })
    if (gateDecision === 'CONNECT_WALLET') {
      void bootstrap.connect()
      return
    }
    if (gateDecision === 'ONBOARD' || gateDecision === 'RECOVER_IDENTITY') {
      openProfileDialog('onboarding')
      return
    }
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
      <HuntHeader profile={adventurer.profile} onProfileClick={trigger => openProfileDialog('profile', trigger)} />
      <PlayWalletStrip
        bootstrap={bootstrap}
        adventurer={adventurer}
        recovering={recovery.status === 'signing'}
        onCreateProfile={() => openProfileDialog('onboarding')}
        onRetryIdentity={adventurer.retryRestore}
      />
      <main className={styles.main}>
        {activeTab === 'hunt' && <>
          <section className={styles.hero} aria-labelledby="play-heading">
            <div className={styles.heroCopy}><span className={styles.kicker}>NIMHUNT · DAILY EXPEDITION</span><h1 id="play-heading">Today's hunt</h1><p>Choose your task, enter the ruins, and make it out alive.</p></div>
            <div className={styles.heroScene}><img src={playAssets.angkor} alt="Angkor Ruins" width={1672} height={941} loading="eager" decoding="async" /><img className={styles.heroExplorer} src={playAssets.explorer} alt="" width={1280} height={1280} loading="eager" decoding="async" /><span className={styles.sceneTag}>ANGKOR RUINS · AVAILABLE</span></div>
          </section>
          <HuntStatus hunt={hunt} />
          {payout && <ProductPayoutStatusCard payout={payout} />}
          {treasureWalletConnected && <TreasureBankCta state={treasure} onOpenBank={() => changeTab('bank')} />}
          <MissionList missions={playMissions} onEnter={openMission} compact expeditionsLeftToday={expeditionsLeftToday} />
          <ProgressStrip />
          <WorldStatus />
        </>}
        {activeTab === 'missions' && <>
          <section className={styles.pageIntro} aria-labelledby="missions-page-heading"><span className={styles.kicker}>THE DAILY BOARD</span><h1 id="missions-page-heading">Today's missions</h1><p>Choose your route. The task is clear before the ruins open.</p></section>
          <HuntStatus hunt={hunt} />
          {payout && <ProductPayoutStatusCard payout={payout} />}
          <MissionList missions={playMissions} onEnter={openMission} expeditionsLeftToday={expeditionsLeftToday} />
          <WorldStatus />
        </>}
        {activeTab === 'heroes' && <>
          <section className={styles.pageIntro} aria-labelledby="heroes-page-heading"><span className={styles.kicker}>HALL OF HEROES</span><h1 id="heroes-page-heading">Hall of Heroes</h1><p>Live monthly standings from verified expeditions. Only proven runs count.</p></section>
          {treasureWalletConnected && <YourMonthBlock enabled sessionKey={recovery.epoch} onUnauthorized={() => setPayoutUnauthorized(true)} />}
          <MonthlyHeroesBlock
            selfPlayerId={adventurer.profile?.playerId ?? null}
            onOpenPublicProfile={openPublicProfileDialog}
          />
        </>}
        {activeTab === 'bank' && <>
          <section className={styles.pageIntro} aria-labelledby="bank-page-heading"><span className={styles.kicker}>WALLET TREASURE</span><h1 id="bank-page-heading">Treasure Bank</h1><p>Your secured and delivered NIM, recovered from the wallet-authoritative reward ledger.</p></section>
          <TreasureBankSection state={treasure} onRetry={treasure.retry} />
        </>}
      </main>
      <PlayBottomNav activeTab={activeTab} onChange={changeTab} />
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
      {publicProfilePlayerId && <dialog
        ref={publicProfileDialogRef}
        className={styles.profileDialog}
        aria-label="Public Adventurer profile"
        onClose={() => {
          setPublicProfilePlayerId(null)
          requestAnimationFrame(() => publicProfileTriggerRef.current?.focus())
        }}
      >
        <div className={styles.profileDialogSheet}>
          <PublicAdventurerProfileSheet playerId={publicProfilePlayerId} onClose={closePublicProfileDialog} onSocialChanged={() => setSocialRevision(version => version + 1)} />
        </div>
      </dialog>}
      <dialog
        ref={profileDialogRef}
        className={styles.profileDialog}
        aria-labelledby={profileDialogMode === 'allies' && identityPanel === 'PROFILE' ? 'adventurer-allies-title' : profileDialogMode === 'settings' && identityPanel === 'PROFILE' ? 'adventurer-settings-title' : profileDialogMode === 'blocked' && identityPanel === 'PROFILE' ? 'adventurer-blocked-title' : profileDialogMode === 'edit-profile' && identityPanel === 'PROFILE' ? 'adventurer-edit-profile-title' : identityPanel === 'CREATE_PROFILE' ? 'adventurer-display-name-title' : adventurer.status === 'RESTORING' ? 'adventurer-identity-restoring-title' : adventurer.status === 'ERROR' ? 'adventurer-identity-recovery-title' : 'adventurer-identity-connect-title'}
        onClose={() => setProfileDialogMode('profile')}
        onCancel={event => {
          if (REAL_EXPEDITION_PROFILE_GATE_ENABLED && profileDialogMode === 'onboarding') event.preventDefault()
        }}
      >
        <div className={styles.profileDialogSheet}>
          {profileDialogMode === 'allies' && identityPanel === 'PROFILE' && adventurer.profile
            ? <AlliesPanel
              key={`allies-${socialRevision}`}
              onClose={() => setProfileDialogMode('profile')}
              onOpenPublicProfile={openPublicProfileDialog}
              onSocialChanged={() => setSocialRevision(version => version + 1)}
            />
            : identityPanel === 'CREATE_PROFILE'
            ? <AdventurerOnboarding
              key={bootstrap.wallet ?? 'no-wallet'}
              nameState={adventurer.nameState}
              creationStatus={adventurer.creationStatus}
              creationError={adventurer.creationError}
              checkName={adventurer.checkName}
              createProfile={adventurer.createProfile}
              onComplete={closeProfileDialog}
              identityStatus={adventurer.status}
              identityError={adventurer.error}
              retryRestore={adventurer.retryRestore}
              onTryPractice={() => {
                closeProfileDialog()
                changeTab('missions')
              }}
            />
            : profileDialogMode === 'edit-profile' && identityPanel === 'PROFILE' && adventurer.profile
            ? <AdventurerEditProfilePanel
              key={`${adventurer.profile.updatedAt}-edit`}
              profile={adventurer.profile}
              updateAvatar={adventurer.updateAvatar}
              updateError={adventurer.creationError}
              renameProfile={adventurer.renameProfile}
              renameStatus={adventurer.renameStatus}
              renameError={adventurer.renameError}
              resetRename={adventurer.resetRename}
              checkName={adventurer.checkName}
              nameState={adventurer.nameState}
              onBack={() => setProfileDialogMode('profile')}
            />
            : profileDialogMode === 'settings' && identityPanel === 'PROFILE' && adventurer.profile
            ? <AdventurerSettingsPanel
              profile={adventurer.profile}
              wallet={bootstrap.wallet}
              onBack={() => setProfileDialogMode('profile')}
              onOpenBlocked={() => setProfileDialogMode('blocked')}
            />
            : profileDialogMode === 'blocked' && identityPanel === 'PROFILE' && adventurer.profile
            ? <BlockedAdventurersPanel onBack={() => setProfileDialogMode('settings')} />
            : identityPanel === 'PROFILE' && adventurer.profile
            ? <AdventurerProfilePanel
              key={`${adventurer.profile.updatedAt}-${socialRevision}`}
              profile={adventurer.profile}
              onOpenAllies={openAllies}
              onOpenEditProfile={() => setProfileDialogMode('edit-profile')}
              onOpenSettings={() => setProfileDialogMode('settings')}
              onClose={closeProfileDialog}
            />
            : <AdventurerIdentityStatus status={adventurer.status} error={adventurer.error} retryRestore={adventurer.retryRestore} />}
        </div>
      </dialog>
      <div className={styles.footerMark}>Built for Nimiq Pay</div>
    </div>
  </div>
}

function PlayWalletStrip({
  bootstrap,
  adventurer,
  recovering,
  onCreateProfile,
  onRetryIdentity,
}: {
  readonly bootstrap: ReturnType<typeof usePlayWalletBootstrap>
  readonly adventurer: ReturnType<typeof useAdventurer>
  readonly recovering: boolean
  readonly onCreateProfile: () => void
  readonly onRetryIdentity: () => void
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
      <span className={styles.walletIdentity}>WALLET CONNECTED</span>
      <span className={styles.visuallyHidden}>{shortenNqWallet(bootstrap.wallet)}</span>
      {recovering && <span role="status">{PLAY_WALLET_BOOTSTRAP_COPY.RECOVERING}</span>}
      {adventurer.status === 'RESTORING' && <span role="status">Restoring Adventurer identity…</span>}
      {adventurer.status === 'NEEDS_PROFILE' && <>
        <span className={styles.walletCopy}>Create an Adventurer profile to put your name on the trail.</span>
        <button className={styles.sheetPrimary} type="button" onClick={onCreateProfile}>Create Adventurer profile</button>
      </>}
      {adventurer.status === 'ERROR' && <>
        <span className={styles.walletCopy}>Adventurer identity could not be restored. Your profile was not changed.</span>
        <button className={styles.sheetSecondary} type="button" onClick={onRetryIdentity}>Retry identity session</button>
      </>}
    </div>
  }
  return null
}
