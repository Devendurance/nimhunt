import { useEffect, useState, useSyncExternalStore } from 'react'
import { DISPLAY_NAME_MAX_LENGTH, normalizeAdventurerDisplayName, type AdventurerProfile } from '../../domain/adventurer.ts'
import type { AdventurerApiErrorCode } from '../../api/adventurer.ts'
import type { ClientNameState } from './adventurerState.ts'
import { AvatarPicker, AdventurerAvatarToken } from './AdventurerAvatar'
import styles from './Adventurer.module.css'

type RenameStatus = 'IDLE' | 'SIGNING' | 'RENAMING' | 'SUCCESS' | 'CANCELLED' | 'ERROR'
type RenameError = AdventurerApiErrorCode | 'SIGNATURE_CANCELLED' | 'ADVENTURER_UNAVAILABLE'

export function AdventurerEditProfilePanel({
  profile,
  updateAvatar,
  updateError,
  renameProfile,
  renameStatus,
  renameError,
  resetRename,
  checkName,
  nameState,
  onBack,
}: {
  readonly profile: AdventurerProfile
  readonly updateAvatar: (avatarId: string) => Promise<boolean>
  readonly updateError: string | null
  readonly renameProfile: (newName: string) => Promise<boolean>
  readonly renameStatus: RenameStatus
  readonly renameError: RenameError | null
  readonly resetRename: () => void
  readonly checkName: (name: string) => Promise<void>
  readonly nameState: ClientNameState
  readonly onBack: () => void
}) {
  const [avatarId, setAvatarId] = useState(profile.avatarId)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const clockNow = useSyncExternalStore(subscribeClock, getClockNow, getServerClock)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (normalizeAdventurerDisplayName(displayName) !== normalizeAdventurerDisplayName(profile.displayName)) void checkName(displayName)
    }, 240)
    return () => window.clearTimeout(timer)
  }, [checkName, displayName, profile.displayName])

  const nameChanged = normalizeAdventurerDisplayName(displayName) !== normalizeAdventurerDisplayName(profile.displayName)
  const renameBusy = renameStatus === 'SIGNING' || renameStatus === 'RENAMING'
  const avatarChanged = avatarId !== profile.avatarId
  const cooldownActive = profile.nextRenameAt ? clockNow === 0 || new Date(profile.nextRenameAt).getTime() > clockNow : false
  const canRename = nameChanged
    && nameState.status === 'AVAILABLE'
    && displayName === displayName.trim()
    && !renameBusy
    && !cooldownActive
  const renameMessage = nameChanged
    ? renameStatusMessage(nameState, renameStatus, renameError, profile.nextRenameAt, clockNow)
    : renameEligibilityMessage(profile.nextRenameAt, clockNow)

  const saveAvatar = async () => {
    if (!avatarChanged || avatarSaving) return
    setAvatarSaving(true)
    await updateAvatar(avatarId)
    setAvatarSaving(false)
  }

  return <div className={styles.profileSheet}>
    <div className={styles.subviewHeader}>
      <button type="button" className={styles.backAction} onClick={onBack}>← My Adventurer</button>
      <p className="eyebrow">EDIT PROFILE</p>
      <h2 id="adventurer-edit-profile-title">Edit your Adventurer</h2>
    </div>

    <section className={styles.profileSection} aria-labelledby="edit-avatar-heading">
      <h3 id="edit-avatar-heading">Avatar</h3>
      <div className={styles.editAvatarPreview}><AdventurerAvatarToken avatarId={avatarId} size="medium" /><span>Choose a curated crest.</span></div>
      <AvatarPicker value={avatarId} onChange={setAvatarId} disabled={avatarSaving || renameBusy} title="Avatar selection" />
      {updateError && <p className={styles.profileError} role="alert">{avatarError(updateError)}</p>}
      <button type="button" className={styles.primaryAction} disabled={!avatarChanged || avatarSaving || renameBusy} onClick={() => void saveAvatar()}>
        {avatarSaving ? 'Saving avatar…' : 'Save avatar'}
      </button>
    </section>

    <section className={styles.profileSection} aria-labelledby="rename-heading">
      <h3 id="rename-heading">Display name</h3>
      <label className={styles.visuallyHiddenLabel} htmlFor="rename-display-name">Display name</label>
      <input
        id="rename-display-name"
        className={styles.nameInput}
        value={displayName}
        onChange={event => { setDisplayName(event.target.value); resetRename() }}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="nickname"
        aria-invalid={nameChanged && (nameState.status === 'INVALID' || nameState.status === 'TAKEN' || nameState.status === 'RESERVED')}
        aria-describedby="rename-display-name-hint"
        disabled={renameBusy}
      />
      <p id="rename-display-name-hint" className={`${styles.nameHint} ${nameStatusClass(nameState)}`} aria-live="polite">{renameMessage}</p>
      <button type="button" className={styles.primaryAction} disabled={!canRename} onClick={() => void renameProfile(displayName)}>
        {renameStatus === 'SIGNING' ? 'Approve rename in Nimiq Pay…' : renameStatus === 'RENAMING' ? 'Updating Adventurer…' : 'Rename Adventurer'}
      </button>
      <p className={styles.assetNote}>Renames require a fresh wallet signature. Your player identity, Allies, stats, and rewards stay unchanged.</p>
    </section>

    <button type="button" className={styles.secondaryAction} onClick={onBack}>Back to My Adventurer</button>
  </div>
}

function renameEligibilityMessage(nextRenameAt: string | undefined, clockNow: number): string {
  if (!nextRenameAt) return 'Rename eligibility will appear after your profile refreshes.'
  return clockNow > 0 && new Date(nextRenameAt).getTime() <= clockNow
    ? 'Available now.'
    : `You can rename again on ${formatDate(nextRenameAt)}.`
}

function renameStatusMessage(state: ClientNameState, status: RenameStatus, error: RenameError | null, nextRenameAt: string | undefined, clockNow: number): string {
  if (nextRenameAt && clockNow > 0 && new Date(nextRenameAt).getTime() > clockNow) return `You can rename again on ${formatDate(nextRenameAt)}.`
  if (status === 'SIGNING') return 'Approve the rename signature in Nimiq Pay.'
  if (status === 'RENAMING') return 'Saving your new display name…'
  if (status === 'CANCELLED') return 'Signature cancelled. Your name was not changed.'
  if (status === 'SUCCESS') return 'Display name updated.'
  if (error === 'DISPLAY_NAME_COOLDOWN') return 'Your rename was rejected by the 30-day cooldown.'
  if (error === 'DISPLAY_NAME_TAKEN') return 'That name was claimed while you were signing.'
  if (error === 'DISPLAY_NAME_RESERVED') return 'That name is reserved. Choose another.'
  if (error === 'DISPLAY_NAME_INVALID') return 'Use 3–20 characters with single spaces only.'
  if (error === 'CHALLENGE_EXPIRED' || error === 'CHALLENGE_INVALID') return 'The rename request expired. Try again.'
  if (error === 'SIGNATURE_INVALID') return 'The wallet signature could not be verified.'
  if (error === 'ADVENTURER_SESSION_INVALID') return 'Your Adventurer session expired. Reconnect to continue.'
  if (error === 'NETWORK_ERROR' || error === 'ADVENTURER_UNAVAILABLE') return 'Rename is temporarily unavailable. Try again.'
  if (state.status === 'INVALID') return 'Use 3–20 characters with single spaces only.'
  if (state.status === 'CHECKING') return 'Checking availability…'
  if (state.status === 'AVAILABLE') return 'This name is available.'
  if (state.status === 'TAKEN') return 'That name is already claimed.'
  if (state.status === 'RESERVED') return 'That name is reserved.'
  if (state.status === 'ERROR') return 'Name availability is temporarily unavailable.'
  return 'Choose a new display name.'
}

function nameStatusClass(state: ClientNameState): string {
  if (state.status === 'AVAILABLE') return styles.nameAvailable
  if (state.status === 'CHECKING') return styles.nameChecking
  if (state.status === 'TAKEN') return styles.nameTaken
  if (state.status === 'RESERVED' || state.status === 'INVALID') return styles.nameInvalid
  if (state.status === 'ERROR') return styles.nameError
  return ''
}

function avatarError(error: string): string {
  if (error === 'AVATAR_UNAVAILABLE') return 'That crest is unavailable. Choose another.'
  if (error === 'ADVENTURER_SESSION_INVALID') return 'Your Adventurer session expired. Reconnect to continue.'
  return 'The crest could not be saved. Try again.'
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

let clockSnapshot = 0

function subscribeClock(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const tick = () => {
    clockSnapshot = Date.now()
    onChange()
  }
  tick()
  const timer = window.setInterval(tick, 60_000)
  return () => window.clearInterval(timer)
}

function getClockNow(): number {
  return clockSnapshot
}

function getServerClock(): number {
  return 0
}
