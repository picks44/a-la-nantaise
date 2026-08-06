import { ApiError } from './errors.ts'
import { withTimeout } from './matchGroupRevealState.ts'

/** Timeouts for primary page reads only — not admin/sync/recalculate. */
export const PAGE_LOAD_TIMEOUT_MS = 20_000

export const PAGE_LOAD_TIMEOUT_CODE = 'LOAD_TIMEOUT'

export async function withPageLoadTimeout<T>(
  promise: Promise<T>,
  timeoutMs = PAGE_LOAD_TIMEOUT_MS,
): Promise<T> {
  try {
    return await withTimeout(promise, timeoutMs, PAGE_LOAD_TIMEOUT_CODE)
  } catch (error) {
    if (error instanceof Error && error.message === PAGE_LOAD_TIMEOUT_CODE) {
      throw new ApiError(PAGE_LOAD_TIMEOUT_CODE, PAGE_LOAD_TIMEOUT_CODE)
    }
    throw error
  }
}

/**
 * Deep-link `?match=` policy for calendar cards.
 * - finished / locked: open details (reveal lives there)
 * - next open match: scroll only, do not force-open a details panel
 * - compact future: scroll only
 * - unknown id: no-op
 */
export function shouldOpenDetailsForDeepLink(input: {
  matchFound: boolean
  uiStatus: string | null
  isNextOpen: boolean
}): boolean {
  if (!input.matchFound || input.uiStatus == null) return false
  if (input.isNextOpen) return false
  return input.uiStatus === 'finished' || input.uiStatus === 'locked'
}
