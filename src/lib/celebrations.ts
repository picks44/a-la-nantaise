export type CelebrationEventType = string

export function celebrationStorageKey(args: {
  groupId: string
  playerId: string
  seasonId: string
  eventType: CelebrationEventType
  eventId: string
}): string {
  return `aln:celebration:${args.groupId}:${args.playerId}:${args.seasonId}:${args.eventType}:${args.eventId}`
}

function safeLocalStorageGet(key: string): string | null {
  try {
    const storage = globalThis.localStorage
    if (!storage) return null
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    storage.setItem(key, value)
  } catch {
    // If storage is blocked (private mode, disabled), we just disable replay protection.
  }
}

export function getCelebrationFlag(key: string): boolean {
  return safeLocalStorageGet(key) === '1'
}

export function setCelebrationFlag(key: string): void {
  safeLocalStorageSet(key, '1')
}

export function getCelebrationNumber(key: string): number | null {
  const raw = safeLocalStorageGet(key)
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function setCelebrationNumber(key: string, value: number): void {
  safeLocalStorageSet(key, String(value))
}

