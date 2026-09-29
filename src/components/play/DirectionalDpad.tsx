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
}

const directions = [
  { direction: 'UP', label: 'Up', Icon: ArrowUp },
  { direction: 'LEFT', label: 'Left', Icon: ArrowLeft },
  { direction: 'RIGHT', label: 'Right', Icon: ArrowRight },
  { direction: 'DOWN', label: 'Down', Icon: ArrowDown },
] as const

export function DirectionalDpad({ onMove, inputLocked = false, upRef, onReset }: DirectionalDpadProps) {
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
      onPointerDown={event => handleDirectionalPointerDown(event, direction, onMove, inputLocked)}
      onClick={event => handleDirectionalClick(event, direction, onMove, inputLocked)}
    ><Icon size={26} aria-hidden="true" /></button>)}
    {onReset
      ? <button type="button" className={`${styles.dpadBtn} ${styles.dpadCenter} ${styles.dpadCenterButton}`} aria-label="Reset run" onClick={onReset}>
        <RotateCcw size={16} aria-hidden="true" /><span>Reset run</span>
      </button>
      : <span className={styles.dpadCenter} aria-hidden="true" />}
  </div>
}
