import type { Ref } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, RotateCcw } from 'lucide-react'
import type { Direction } from '../../game/world/grid'
import { handleDirectionalClick, handleDirectionalPointerDown } from './directionalInput'
import styles from './DirectionalDpad.module.css'

type DirectionalDpadProps = {
  readonly onMove: (direction: Direction) => void
  readonly inputLocked?: boolean
  readonly upRef?: Ref<HTMLButtonElement>
  readonly onReset?: () => void
  /** Opt-in V2 holds; absent in existing production/practice callers. */
  readonly heldInput?: {
    press: (source: string, direction: Direction) => void
    release: (source: string) => void
    cancel: (source: string) => void
  }
}

const directions = [
  { direction: 'UP', label: 'Up', Icon: ArrowUp },
  { direction: 'LEFT', label: 'Left', Icon: ArrowLeft },
  { direction: 'RIGHT', label: 'Right', Icon: ArrowRight },
  { direction: 'DOWN', label: 'Down', Icon: ArrowDown },
] as const

export function DirectionalDpad({ onMove, inputLocked = false, upRef, onReset, heldInput }: DirectionalDpadProps) {
  const label = inputLocked ? 'Directional controls (temporarily locked)' : 'Directional controls'

  return <div
    className={styles.dpad}
    data-input-locked={inputLocked ? 'true' : 'false'}
    role="group"
    aria-label={label}
    onContextMenu={event => event.preventDefault()}
  >
    {directions.map(({ direction, label: directionLabel, Icon }) => <button
      key={direction}
      ref={direction === 'UP' ? upRef : undefined}
      type="button"
      className={`${styles.dpadBtn} ${styles[direction.toLowerCase()]}`}
      aria-label={`Move ${directionLabel}`}
      disabled={inputLocked}
      onPointerDown={event => {
        if (!heldInput) { handleDirectionalPointerDown(event, direction, onMove, inputLocked); return }
        if (inputLocked || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        heldInput.press(`pointer:${event.pointerId}`, direction)
      }}
      onPointerUp={event => heldInput?.release(`pointer:${event.pointerId}`)}
      onPointerCancel={event => heldInput?.cancel(`pointer:${event.pointerId}`)}
      onLostPointerCapture={event => heldInput?.cancel(`pointer:${event.pointerId}`)}
      onClick={event => handleDirectionalClick(event, direction, onMove, inputLocked)}
    ><Icon size={26} aria-hidden="true" /></button>)}
    {onReset
      ? <button type="button" className={`${styles.dpadBtn} ${styles.dpadCenter} ${styles.dpadCenterButton}`} aria-label="Reset run" onClick={onReset}>
        <RotateCcw size={16} aria-hidden="true" /><span>Reset run</span>
      </button>
      : <span className={styles.dpadCenter} aria-hidden="true" />}
  </div>
}
