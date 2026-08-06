/**
 * Calendar secondary refresh: generation token, event coalescing, soft UI.
 * Does not own the reveal state machine.
 */

export type CalendarRefreshMode = 'initial' | 'soft'

export function createRefreshCoalescer(options: {
  delayMs?: number
  onFlush: () => void
}) {
  const delayMs = options.delayMs ?? 50
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  return {
    request() {
      pending = true
      if (timer != null) return
      timer = setTimeout(() => {
        timer = null
        if (!pending) return
        pending = false
        options.onFlush()
      }, delayMs)
    },
    dispose() {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
      pending = false
    },
  }
}

export function createGenerationToken() {
  let current = 0
  return {
    next() {
      current += 1
      return current
    },
    bump() {
      current += 1
      return current
    },
    get current() {
      return current
    },
    isCurrent(generation: number) {
      return generation === current
    },
  }
}

export async function runCalendarDataLoad<TBundle>(input: {
  mode: CalendarRefreshMode
  hasExistingData: boolean
  generation: number
  isCurrent: (generation: number) => boolean
  load: () => Promise<TBundle>
  onFullLoading: () => void
  onSoftStart?: () => void
  onSuccess: (bundle: TBundle) => void
  onError: (error: unknown) => void
  onSettled: () => void
}): Promise<'applied' | 'stale' | 'failed'> {
  const showFullLoading = input.mode === 'initial' || !input.hasExistingData
  if (showFullLoading) {
    input.onFullLoading()
  } else {
    input.onSoftStart?.()
  }

  try {
    const bundle = await input.load()
    if (!input.isCurrent(input.generation)) {
      return 'stale'
    }
    input.onSuccess(bundle)
    return 'applied'
  } catch (error) {
    if (!input.isCurrent(input.generation)) {
      return 'stale'
    }
    input.onError(error)
    return 'failed'
  } finally {
    if (input.isCurrent(input.generation)) {
      input.onSettled()
    }
  }
}
