import { useSoundEnabled } from '../../audio/useNimhuntAudio'

/**
 * Small presentation-only sound toggle for /play shell + gameplay headers.
 * Mute silences BGM + SFX, persists to localStorage, and never blocks play.
 */
export function SoundToggle() {
  const { enabled, toggle } = useSoundEnabled()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={enabled ? 'Mute sound' : 'Unmute sound'}
      aria-pressed={!enabled}
      title={enabled ? 'Mute sound' : 'Unmute sound'}
      className="nimhunt-sound-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 44,
        minHeight: 44,
        padding: '0 10px',
        borderRadius: 9999,
        border: '1px solid rgba(243, 234, 215, 0.25)',
        background: 'rgba(0, 0, 0, 0.25)',
        color: '#f3ead7',
        fontSize: 20,
        lineHeight: 1,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true">{enabled ? '🔊' : '🔇'}</span>
    </button>
  )
}
