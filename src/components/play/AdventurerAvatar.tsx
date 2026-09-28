import {
  ADVENTURER_AVATAR_CATALOGUE,
  ADVENTURER_LEGACY_AVATAR_COMPATIBILITY,
  type AdventurerAvatar as AdventurerAvatarContract,
} from '../../domain/adventurer.ts'
import { getAdventurerAvatarArt } from './adventurerAssets'
import { PlayIcon } from './PlayIcon'
import styles from './Adventurer.module.css'

export function AdventurerAvatarToken({ avatarId, size = 'medium' }: { readonly avatarId: string; readonly size?: 'small' | 'medium' | 'large' }) {
  const avatar = findAvatar(avatarId)
  const order = avatar?.sortOrder ?? 0
  const art = getAdventurerAvatarArt(avatarId)
  return <span className={`${styles.avatarToken} ${styles[`avatarToken${capitalize(size)}`]}`} data-avatar-id={avatarId} aria-hidden="true">
    {art
      ? <img className={styles.avatarArt} src={art} alt="" decoding="async" />
      : <>
        <span className={styles.avatarGlow} />
        <PlayIcon name="sparkles" size={size === 'large' ? 28 : size === 'medium' ? 22 : 16} />
      </>}
    <span className={styles.avatarNumber}>{String(order).padStart(2, '0')}</span>
  </span>
}

export function AvatarPicker({
  value,
  onChange,
  disabled = false,
  title = 'Choose an avatar',
}: {
  readonly value: string
  readonly onChange: (avatarId: string) => void
  readonly disabled?: boolean
  readonly title?: string
}) {
  const avatars = ADVENTURER_AVATAR_CATALOGUE.filter(avatar => avatar.active)

  const moveFocus = (currentId: string, direction: -1 | 1) => {
    const selectable = avatars.filter(avatar => avatar.starter)
    const index = selectable.findIndex(avatar => avatar.avatarId === currentId)
    if (index < 0) return
    const next = selectable[(index + direction + selectable.length) % selectable.length]
    if (!next) return
    onChange(next.avatarId)
    document.querySelector<HTMLButtonElement>(`[data-avatar-picker-id="${next.avatarId}"]`)?.focus()
  }

  return <fieldset className={styles.avatarFieldset} disabled={disabled}>
    <legend className={styles.fieldLabel}>{title}</legend>
    <div className={styles.avatarGrid} role="radiogroup" aria-label="Curated Adventurer avatar choices">
      {avatars.map(avatar => {
        const selectable = avatar.starter
        return <button
          key={avatar.avatarId}
          type="button"
          role="radio"
          aria-checked={selectable && value === avatar.avatarId}
          aria-disabled={!selectable || undefined}
          aria-label={`${formatRarity(avatar.rarity)} avatar ${String(avatar.sortOrder).padStart(2, '0')}${selectable ? '' : ', locked'}`}
          data-avatar-picker-id={avatar.avatarId}
          data-locked={!selectable || undefined}
          className={styles.avatarChoice}
          data-selected={selectable && value === avatar.avatarId || undefined}
          disabled={!selectable || disabled}
          onClick={() => onChange(avatar.avatarId)}
          onKeyDown={event => {
            if (!selectable) return
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
          <span>{formatRarity(avatar.rarity)}</span>
          <small>{selectable ? 'SELECT' : 'LOCKED'}</small>
        </button>
      })}
    </div>
    <p className={styles.assetNote}>Common avatars are available now. Higher-tier avatars are curated future content and cannot be selected yet.</p>
  </fieldset>
}

function findAvatar(avatarId: string): AdventurerAvatarContract | null {
  return ADVENTURER_AVATAR_CATALOGUE.find(avatar => avatar.avatarId === avatarId)
    ?? ADVENTURER_LEGACY_AVATAR_COMPATIBILITY.find(avatar => avatar.avatarId === avatarId)
    ?? null
}

function formatRarity(rarity: AdventurerAvatarContract['rarity']): string {
  return rarity.charAt(0) + rarity.slice(1).toLocaleLowerCase('en-US')
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
