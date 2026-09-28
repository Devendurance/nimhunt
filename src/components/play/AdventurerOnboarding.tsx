import { useEffect, useState } from 'react'
import { DISPLAY_NAME_MAX_LENGTH } from '../../domain/adventurer.ts'
import { AvatarPicker } from './AdventurerAvatar'
import type { AdventurerClientStatus, AdventurerCreationStatus, ClientNameState } from './adventurerState.ts'
import styles from './Adventurer.module.css'

export function AdventurerOnboarding({
  nameState,
  creationStatus,
  creationError,
  checkName,
  createProfile,
  onComplete,
  onTryPractice,
  identityStatus,
}: {
  readonly nameState: ClientNameState
  readonly creationStatus: AdventurerCreationStatus
  readonly creationError: string | null
  readonly checkName: (name: string) => Promise<void>
  readonly createProfile: (displayName: string, avatarId: string) => Promise<boolean>
  readonly onComplete: () => void
  readonly onTryPractice: () => void
  readonly identityStatus: AdventurerClientStatus
}) {
  const nameId = 'adventurer-display-name'
  const [displayName, setDisplayName] = useState('')
  const [avatarId, setAvatarId] = useState('common-01')

  useEffect(() => {
    const timer = window.setTimeout(() => void checkName(displayName), 240)
    return () => window.clearTimeout(timer)
  }, [checkName, displayName])

  useEffect(() => {
    if (creationStatus === 'SUCCESS') onComplete()
  }, [creationStatus, onComplete])

  const busy = creationStatus === 'SIGNING' || creationStatus === 'CREATING'
  const valid = nameState.status === 'AVAILABLE'
    && displayName.length > 0
    && displayName.trim().toLocaleLowerCase('en-US') === nameState.normalizedName
    && Boolean(avatarId)
    && !busy
    && identityStatus !== 'RESTORING'
    && identityStatus !== 'DISCONNECTED'
  const statusMessage = nameStatusMessage(nameState)
  const actionMessage = identityStatus === 'RESTORING'
    ? 'Restoring your Adventurer identity…'
    : creationStatus === 'SIGNING'
    ? 'Approve the identity signature in Nimiq Pay.'
    : creationStatus === 'CREATING'
      ? 'Saving your Adventurer profile…'
      : creationStatus === 'CANCELLED'
        ? 'Signature cancelled. Your profile was not created.'
        : creationStatus === 'ERROR'
          ? creationErrorMessage(creationError)
          : null

  return <div className={styles.profileSheet}>
    <div className={styles.onboardingIntro}>
      <p className="eyebrow">ADVENTURER IDENTITY</p>
      <h2 id={`${nameId}-title`}>Name your expedition self.</h2>
      <p>Your wallet still authorizes every expedition. This profile gives your victories a durable name and crest. Verified history will appear when you claim your identity.</p>
    </div>

    <div className={styles.nameField}>
      <label htmlFor={nameId}>Display name</label>
      <input
        id={nameId}
        className={styles.nameInput}
        value={displayName}
        onChange={event => setDisplayName(event.target.value)}
        placeholder="e.g. Moss Runner"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="nickname"
        autoFocus
        aria-invalid={nameState.status === 'INVALID' || nameState.status === 'TAKEN' || nameState.status === 'RESERVED'}
        aria-describedby={`${nameId}-hint`}
        disabled={busy}
      />
      <p id={`${nameId}-hint`} className={`${styles.nameHint} ${nameStatusClass(nameState)}`} aria-live="polite">
        {statusMessage}
      </p>
    </div>

    <AvatarPicker value={avatarId} onChange={setAvatarId} disabled={busy} title="Choose a starter avatar" />

    {actionMessage && <p className={styles.profileError} role="status" aria-live="polite">{actionMessage}</p>}

    <div className={styles.onboardingActions}>
      <button
        type="button"
        className={styles.primaryAction}
        disabled={!valid}
        onClick={() => void createProfile(displayName, avatarId)}
      >
        {busy ? 'Creating profile…' : 'Create Adventurer profile'}
      </button>
      <p className={styles.assetNote}>One signature creates your identity session. No NIM transaction is sent.</p>
      <button type="button" className={styles.secondaryAction} onClick={onTryPractice} disabled={busy}>Try Practice instead</button>
    </div>
  </div>
}

function nameStatusMessage(state: ClientNameState): string {
  if (state.status === 'IDLE') return '3–20 characters: letters, numbers, spaces, or underscores.'
  if (state.status === 'INVALID') return 'Use 3–20 characters with single spaces only.'
  if (state.status === 'CHECKING') return 'Checking availability…'
  if (state.status === 'AVAILABLE') return 'This name is available.'
  if (state.status === 'TAKEN') return 'That name is already claimed.'
  if (state.status === 'RESERVED') return 'Choose a different name.'
  return 'Name availability is temporarily unavailable. Try again.'
}

function nameStatusClass(state: ClientNameState): string {
  if (state.status === 'AVAILABLE') return styles.nameAvailable
  if (state.status === 'CHECKING') return styles.nameChecking
  if (state.status === 'TAKEN') return styles.nameTaken
  if (state.status === 'RESERVED') return styles.nameReserved
  if (state.status === 'INVALID') return styles.nameInvalid
  if (state.status === 'ERROR') return styles.nameError
  return ''
}

function creationErrorMessage(error: string | null): string {
  if (error === 'DISPLAY_NAME_TAKEN') return 'That name was claimed while you were signing. Choose another.'
  if (error === 'DISPLAY_NAME_RESERVED' || error === 'DISPLAY_NAME_INVALID') return 'That display name cannot be used. Choose another.'
  if (error === 'SIGNATURE_INVALID') return 'The identity signature could not be verified. Try again.'
  if (error === 'CHALLENGE_EXPIRED' || error === 'CHALLENGE_INVALID') return 'The identity request expired. Try again.'
  if (error === 'ADVENTURER_UNAVAILABLE') return 'Adventurer identity is temporarily unavailable. Try again.'
  if (error === 'NETWORK_ERROR') return 'Connection interrupted. Try again.'
  if (error === 'PROFILE_ALREADY_EXISTS') return 'This wallet already has an Adventurer profile. Refresh to continue.'
  if (error === 'AVATAR_UNAVAILABLE') return 'That crest is unavailable. Choose another.'
  return 'Profile creation failed. Try again.'
}
