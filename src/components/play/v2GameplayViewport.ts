import { traversalViewport } from '../../game/traversal/angkorV2/camera'

/** Presentation pixels only; grid, zoom and camera follow rules are unchanged. */
export function fitV2Playfield(screenWidth: number, availableWidth: number, availableHeight: number) {
  const width = traversalViewport(screenWidth).width
  const displayWidth = Math.max(1, Math.min(width, availableWidth))
  const scale = displayWidth / width
  const height = Math.max(96, Math.min(320, Math.floor(availableHeight / scale)))
  return { width, height, displayWidth, displayHeight: height * scale }
}

/** Coalesce Safari chrome/rotation and room-size changes into one animation frame.
 * Keep the viewport object shared with the scene; never restart its state. */
export function observeV2Playfield(shell: HTMLElement, room: HTMLElement, host: HTMLElement,
  viewport: { width: number; height: number }, resize: () => void) {
  let frame = 0
  const measure = () => {
    frame = 0
    const visual = window.visualViewport
    shell.style.setProperty('--v2-viewport-height', `${visual?.height ?? window.innerHeight}px`)
    shell.style.setProperty('--v2-viewport-top', `${visual?.offsetTop ?? 0}px`)
    const fit = fitV2Playfield(window.innerWidth, room.clientWidth, room.clientHeight)
    host.style.width = `${fit.displayWidth}px`
    host.style.height = `${fit.displayHeight}px`
    if (viewport.width !== fit.width || viewport.height !== fit.height) {
      viewport.width = fit.width; viewport.height = fit.height
      resize()
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
  const observer = new ResizeObserver(schedule)
  observer.observe(room)
  window.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('resize', schedule)
  window.visualViewport?.addEventListener('scroll', schedule)
  measure()
  return () => {
    cancelAnimationFrame(frame); observer.disconnect()
    window.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('resize', schedule)
    window.visualViewport?.removeEventListener('scroll', schedule)
  }
}
