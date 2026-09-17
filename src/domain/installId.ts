export const INSTALL_ID_STORAGE_KEY = 'nimhunt_install_id'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function isInstallId(value: unknown): value is string {
  return typeof value === 'string' && (UUID_PATTERN.test(value) || TOKEN_PATTERN.test(value))
}

export function readInstallId(storage: Pick<Storage, 'getItem'> | null = browserStorage()): string | null {
  if (!storage) return null
  try {
    const existing = storage.getItem(INSTALL_ID_STORAGE_KEY)
    return isInstallId(existing) ? existing : null
  } catch {
    return null
  }
}

export function getOrCreateInstallId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage(),
  randomId: () => string = createRandomInstallId,
): string {
  const existing = readInstallId(storage)
  if (existing) return existing
  const created = randomId()
  if (storage) {
    try {
      storage.setItem(INSTALL_ID_STORAGE_KEY, created)
    } catch {
      /* private mode / quota — still return the in-memory id for this session */
    }
  }
  return created
}

export function createRandomInstallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}
