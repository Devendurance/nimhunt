import { ADVENTURER_AVATAR_CATALOGUE, type AdventurerAvatar as AdventurerAvatarContract } from '../../domain/adventurer.ts'
import { PlayIcon } from './PlayIcon'
import styles from './Adventurer.module.css'

export function AdventurerAvatarToken({ avatarId, size = 'medium' }: { readonly avatarId: string; readonly size?: 'small' | 'medium' | 'large' }) {
  const avatar = findAvatar(avatarId)
  const order = avatar?.sortOrder ?? 0
  return <span className={`${styles.avatarToken} ${styles[`avatarToken${capitalize(size)}`]}`} data-avatar-id={avatarId} aria-hidden="true">
    <span className={styles.avatarGlow} />
    <PlayIcon name="sparkles" size={size === 'large' ? 28 : size === 'medium' ? 22 : 16} />
    <span className={styles.avatarNumber}>{String(order).padStart(2, '0')}</span>
  </span>
}

export function AvatarPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: string
  readonly onChange: (avatarId: string) => void
  readonly disabled?: boolean
}) {
  const avatars = ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.active && avatar.starter)

  const moveFocus = (currentId: string, direction: -1 | 1) => {
    const index = avatars.findIndex(avatar => avatar.avatarId === currentId)
    if (index < 0) return
    const next = avatars[(index + direction + avatars.length) % avatars.length]
    if (!next) return
    onChange(next.avatarId)
    document.querySelector<HTMLButtonElement>(`[data-avatar-picker-id="${next.avatarId}"]`)?.focus()
  }

  return <fieldset className={styles.avatarFieldset} disabled={disabled}>
    <legend className={styles.fieldLabel}>Choose a starter crest</legend>
    <div className={styles.avatarGrid} role="radiogroup" aria-label="Starter avatar choices">
      {avatars.map(avatar => <button
        key={avatar.avatarId}
        type="button"
        role="radio"
        aria-checked={value === avatar.avatarId}
        aria-label={`Starter avatar ${String(avatar.sortOrder).padStart(2, '0')}`}
        data-avatar-picker-id={avatar.avatarId}
        className={styles.avatarChoice}
        data-selected={value === avatar.avatarId || undefined}
        onClick={() => onChange(avatar.avatarId)}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault()
            moveFocus(avatar.avatarId, 1)
          }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault()
            moveFocus(avatar.avatarId, -1)
          }
        }}
      >
        <AdventurerAvatarToken avatarId={avatar.avatarId} size="medium" />
        <span>CREST {String(avatar.sortOrder).padStart(2, '0')}</span>
      </button>)}
    </div>
    <p className={styles.assetNote}>Starter crest IDs are saved to your Adventurer profile. Portrait art will bind to these durable choices when the approved pack is available.</p>
  </fieldset>
}

function findAvatar(avatarId: string): AdventurerAvatarContract | null {
  return ADVENTURER_AVATAR_CATALOGUE.find(avatar => avatar.avatarId === avatarId) ?? null
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
