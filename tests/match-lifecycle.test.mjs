import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MATCH_LIVE_WINDOW_MS,
  MATCH_RESULT_POLL_GRACE_MS,
  RESULT_SYNC_MIN_ELAPSED_MS,
  classifyMatchPhase,
  hasMatchNeedingResultSync,
  matchAwaitsOfficialResult,
  matchIsLive,
  matchIsStaleAwaiting,
  matchPhaseHeadline,
  shouldPollForOfficialResult,
  shouldShowFixtureSyncHealthAlert,
} from '../src/lib/matchLifecycle.ts'

function match(partial) {
  return {
    kickoffAt: partial.kickoffAt,
    kickoffTimeConfirmed: partial.kickoffTimeConfirmed ?? true,
    dbStatus: partial.dbStatus ?? 'scheduled',
  }
}

const kickoff = '2026-08-14T18:45:00.000Z'
const kickoffMs = Date.parse(kickoff)

describe('classifyMatchPhase', () => {
  it('is upcoming before kickoff', () => {
    assert.equal(
      classifyMatchPhase(match({ kickoffAt: kickoff }), new Date(kickoffMs - 1000)),
      'upcoming',
    )
  })

  it('is live at exact kickoff and during the 150 minute window', () => {
    assert.equal(
      classifyMatchPhase(match({ kickoffAt: kickoff }), new Date(kickoffMs)),
      'live',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff }),
        new Date(kickoffMs + 30 * 60 * 1000),
      ),
      'live',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff }),
        new Date(kickoffMs + 90 * 60 * 1000),
      ),
      'live',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff }),
        new Date(kickoffMs + MATCH_LIVE_WINDOW_MS - 1),
      ),
      'live',
    )
    assert.equal(MATCH_LIVE_WINDOW_MS, 150 * 60 * 1000)
  })

  it('becomes awaiting_result at the end of the live window', () => {
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff }),
        new Date(kickoffMs + MATCH_LIVE_WINDOW_MS),
      ),
      'awaiting_result',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff }),
        new Date(kickoffMs + 4 * 60 * 60 * 1000),
      ),
      'awaiting_result',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff }),
        new Date(kickoffMs + 4 * 24 * 60 * 60 * 1000),
      ),
      'awaiting_result',
    )
  })

  it('honors terminal and unconfirmed statuses', () => {
    const now = new Date(kickoffMs + 60 * 60 * 1000)
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff, dbStatus: 'finished' }),
        now,
      ),
      'finished',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff, dbStatus: 'postponed' }),
        now,
      ),
      'postponed',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff, dbStatus: 'cancelled' }),
        now,
      ),
      'cancelled',
    )
    assert.equal(
      classifyMatchPhase(
        match({ kickoffAt: kickoff, kickoffTimeConfirmed: false }),
        now,
      ),
      'unconfirmed',
    )
  })
})

describe('match lifecycle helpers', () => {
  it('flags live vs stale awaiting', () => {
    const liveNow = new Date(kickoffMs + 10 * 60 * 1000)
    const staleNow = new Date(kickoffMs + 4 * 24 * 60 * 60 * 1000)
    const liveMatch = match({ kickoffAt: kickoff })
    assert.equal(matchIsLive(liveMatch, liveNow), true)
    assert.equal(matchIsStaleAwaiting(liveMatch, liveNow), false)
    assert.equal(matchAwaitsOfficialResult(liveMatch, liveNow), true)
    assert.equal(matchIsLive(liveMatch, staleNow), false)
    assert.equal(matchIsStaleAwaiting(liveMatch, staleNow), true)
    assert.equal(matchAwaitsOfficialResult(liveMatch, staleNow), true)
  })

  it('polls live and recent awaiting, not multi-day stale awaiting', () => {
    const liveNow = new Date(kickoffMs + 20 * 60 * 1000)
    const recentAwaiting = new Date(
      kickoffMs + MATCH_LIVE_WINDOW_MS + 60 * 60 * 1000,
    )
    const staleNow = new Date(
      kickoffMs + MATCH_LIVE_WINDOW_MS + MATCH_RESULT_POLL_GRACE_MS + 1000,
    )
    const row = match({ kickoffAt: kickoff })
    assert.equal(shouldPollForOfficialResult([row], liveNow), true)
    assert.equal(shouldPollForOfficialResult([row], recentAwaiting), true)
    assert.equal(shouldPollForOfficialResult([row], staleNow), false)
    assert.equal(
      shouldPollForOfficialResult(
        [match({ kickoffAt: kickoff, dbStatus: 'finished' })],
        liveNow,
      ),
      false,
    )
  })

  it('labels live and awaiting phases', () => {
    assert.equal(matchPhaseHeadline('live'), 'Match en cours')
    assert.equal(matchPhaseHeadline('awaiting_result'), 'Résultat en attente')
  })

  it('detects SQL-equivalent catch-up window after 105 minutes', () => {
    const tooEarly = new Date(kickoffMs + RESULT_SYNC_MIN_ELAPSED_MS - 1)
    const atThreshold = new Date(kickoffMs + RESULT_SYNC_MIN_ELAPSED_MS)
    const daysLater = new Date(kickoffMs + 4 * 24 * 60 * 60 * 1000)
    const row = match({ kickoffAt: kickoff })
    assert.equal(hasMatchNeedingResultSync([row], tooEarly), false)
    assert.equal(hasMatchNeedingResultSync([row], atThreshold), true)
    assert.equal(hasMatchNeedingResultSync([row], daysLater), true)
    assert.equal(
      hasMatchNeedingResultSync(
        [match({ kickoffAt: kickoff, dbStatus: 'finished' })],
        daysLater,
      ),
      false,
    )
  })

  it('shows admin health alert on failed attempt or stale success while catch-up needed', () => {
    const daysLater = new Date(kickoffMs + 4 * 24 * 60 * 60 * 1000)
    const rows = [match({ kickoffAt: kickoff })]
    assert.equal(
      shouldShowFixtureSyncHealthAlert({
        lastSyncedAt: daysLater.toISOString(),
        lastAttemptOk: false,
        matches: rows,
        now: daysLater,
      }),
      true,
    )
    assert.equal(
      shouldShowFixtureSyncHealthAlert({
        lastSyncedAt: '2026-08-10T05:15:00.000Z',
        lastAttemptOk: true,
        matches: rows,
        now: daysLater,
      }),
      true,
    )
    assert.equal(
      shouldShowFixtureSyncHealthAlert({
        lastSyncedAt: daysLater.toISOString(),
        lastAttemptOk: true,
        matches: rows,
        now: daysLater,
      }),
      false,
    )
  })
})
