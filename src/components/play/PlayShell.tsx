import { useEffect, useRef, useState } from 'react'
import { playAssets } from '../../data/assets'
import { playMissions } from '../../data/play'
import { playFixture } from '../../data/play.fixtures'
import type { Mission, MissionId, PlayTab } from '../../types/play'
import { HeroesPreview } from './HeroesPreview'
import { HuntHeader } from './HuntHeader'
import { HuntStatus } from './HuntStatus'
import { MissionBrief } from './MissionBrief'
import { MissionList } from './MissionList'
import { PlayBottomNav } from './PlayBottomNav'
import { ProgressStrip } from './ProgressStrip'
import { WorldStatus } from './WorldStatus'
import styles from './PlayShell.module.css'

export function PlayShell({ initialTab = 'hunt' }: { initialTab?: PlayTab }) {
  const [activeTab, setActiveTab] = useState<PlayTab>(initialTab)
  const [selectedMissionId, setSelectedMissionId] = useState<MissionId | null>(null)
  const [sheetMode, setSheetMode] = useState<'brief' | 'development'>('brief')
  const sourceTab = useRef<PlayTab>('hunt')
  const trigger = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const selectedMission = playMissions.find(mission => mission.id === selectedMissionId) ?? null

  useEffect(() => {
    if (selectedMission && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }, [selectedMission])

  const openMission = (mission: Mission, button: HTMLButtonElement) => {
    sourceTab.current = activeTab
    trigger.current = button
    setSheetMode('brief')
    setSelectedMissionId(mission.id)
  }

  const closeSheet = () => dialogRef.current?.close()

  const handleClose = () => {
    setSelectedMissionId(null)
    setSheetMode('brief')
    requestAnimationFrame(() => trigger.current?.focus())
  }

  const handleReturnToMissions = () => {
    setActiveTab(sourceTab.current)
    closeSheet()
  }

  return <div className={styles.shell}>
    <div className={styles.viewport}>
      <HuntHeader />
      <main className={styles.main}>
        {activeTab === 'hunt' && <>
          <section className={styles.hero} aria-labelledby="play-heading">
            <div className={styles.heroCopy}><span className={styles.kicker}>NIMHUNT · DAILY EXPEDITION</span><h1 id="play-heading">Today's hunt</h1><p>Choose your task, enter the ruins, and make it out alive.</p></div>
            <div className={styles.heroScene}><img src={playAssets.angkor} alt="Angkor Ruins" width={1672} height={941} loading="eager" decoding="async" /><img className={styles.heroExplorer} src={playAssets.explorer} alt="" width={1280} height={1280} loading="eager" decoding="async" /><span className={styles.sceneTag}>ANGKOR RUINS · AVAILABLE</span></div>
          </section>
          <HuntStatus fixture={playFixture} />
          <MissionList missions={playMissions} onEnter={openMission} compact />
          <ProgressStrip fixture={playFixture} />
          <HeroesPreview fixture={playFixture} compact />
          <WorldStatus />
        </>}
        {activeTab === 'missions' && <>
          <section className={styles.pageIntro} aria-labelledby="missions-page-heading"><span className={styles.kicker}>THE DAILY BOARD · PREVIEW</span><h1 id="missions-page-heading">Today's missions</h1><p>Choose your route. The task is clear before the ruins open.</p></section>
          <MissionList missions={playMissions} onEnter={openMission} />
          <WorldStatus />
        </>}
        {activeTab === 'heroes' && <>
          <section className={styles.pageIntro} aria-labelledby="heroes-page-heading"><span className={styles.kicker}>SAMPLE RANKING · NOT LIVE</span><h1 id="heroes-page-heading">Hall of Heroes</h1><p>Leave a mark in the ruins with points, streaks, and completed expeditions.</p></section>
          <HeroesPreview fixture={playFixture} />
          <ProgressStrip fixture={playFixture} />
        </>}
      </main>
      <PlayBottomNav activeTab={activeTab} onChange={setActiveTab} />
      {selectedMission && <MissionBrief mission={selectedMission} mode={sheetMode} dialogRef={dialogRef} onBack={sheetMode === 'brief' ? closeSheet : () => setSheetMode('brief')} onStart={() => setSheetMode('development')} onReturnToMissions={handleReturnToMissions} onClose={handleClose} />}
      <div className={styles.footerMark}>Built for Nimiq Pay · shell preview</div>
    </div>
  </div>
}
