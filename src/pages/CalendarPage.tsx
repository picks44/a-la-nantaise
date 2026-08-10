import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { MatchListItem } from '../components/MatchListItem'
import { PageHeader } from '../components/PageHeader'
import { TabButton, TabList } from '../components/TabList'
import { useSession } from '../context/useSession'
import {
  fetchActiveSeason,
  fetchMatchGroupReveal,
  fetchMatches,
  fetchMyPredictions,
  findLastFinishedMatch,
  findNextOpenMatch,
  getPredictionForMatch,
  withPredictionStatus,
} from '../lib/api'
import {
  createGenerationToken,
  runSoftPageLoad,
} from '../lib/calendarRefresh'
import {
  attachSoftPageRefresh,
  hasMatchAwaitingOfficialResult,
} from '../lib/softPageRefresh'
import { shouldShowJumpToNextMatch } from '../lib/matchOrder'
import { toUserMessage, UNKNOWN_USER_MESSAGE } from '../lib/errors'
import {
  createInFlightGuard,
  loadCalendarBundle,
} from '../lib/pageLoad'
import { shouldOpenDetailsForDeepLink } from '../lib/pageLoadTimeout'
import {
  REVEAL_TIMEOUT_MESSAGE,
  createRevealLoader,
  getRevealState,
  revealReducer,
  selectIdleRevealIds,
  type RevealAction,
  type RevealStateByMatchId,
} from '../lib/matchGroupRevealState'
import type { Match, Prediction, Season } from '../types'

const MATCH_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CalendarBundle = {
  season: Season
  matches: Match[]
  predictions: Prediction[]
}

type CalendarTab = 'upcoming' | 'finished'

const CALENDAR_TAB_ORDER: readonly CalendarTab[] = ['upcoming', 'finished']

export function CalendarPage() {
  const { sessionToken, playerId } = useSession()
  const [searchParams] = useSearchParams()
  const highlightMatchId = useMemo(() => {
    const raw = searchParams.get('match')
    return raw && MATCH_ID_RE.test(raw) ? raw : null
  }, [searchParams])

  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [season, setSeason] = useState<Season | null>(null)
  const [revealStates, dispatchRevealState] = useReducer(
    revealReducer,
    {} as RevealStateByMatchId,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [tab, setTab] = useState<CalendarTab>('upcoming')
  /** Ouverture des détails indexée par matchId (survit aux refresh). */
  const [detailsOpenById, setDetailsOpenById] = useState<Record<string, boolean>>(
    {},
  )

  const nextRevealRequestIdRef = useRef(0)
  /** Miroir synchrone de revealStates pour loadReveal sans dep React. */
  const revealStatesRef = useRef(revealStates)
  const sessionTokenRef = useRef(sessionToken)
  const seasonIdRef = useRef(season?.id)
  const revealableMatchIdsRef = useRef<string[]>([])
  const loadGuardRef = useRef(createInFlightGuard())
  const dataGenerationRef = useRef(createGenerationToken())
  const hasExistingDataRef = useRef(false)
  /** Scroll #prochain-match après bascule Terminés → À venir (jump). */
  const pendingScrollToNextRef = useRef(false)

  useEffect(() => {
    revealStatesRef.current = revealStates
  }, [revealStates])

  useEffect(() => {
    sessionTokenRef.current = sessionToken
  }, [sessionToken])

  useEffect(() => {
    seasonIdRef.current = season?.id
  }, [season?.id])

  useEffect(() => {
    hasExistingDataRef.current = matches.length > 0
  }, [matches.length])

  const revealLoaderRef = useRef<ReturnType<typeof createRevealLoader> | null>(
    null,
  )
  if (revealLoaderRef.current == null) {
    revealLoaderRef.current = createRevealLoader({
      getStates: () => revealStatesRef.current,
      commit: (action: RevealAction) => {
        revealStatesRef.current = revealReducer(revealStatesRef.current, action)
        dispatchRevealState(action)
      },
      nextRequestId: () => ++nextRevealRequestIdRef.current,
      fetchReveal: (matchId) => {
        const token = sessionTokenRef.current
        const seasonId = seasonIdRef.current
        if (!token || !seasonId) {
          return Promise.reject(new Error(REVEAL_TIMEOUT_MESSAGE))
        }
        return fetchMatchGroupReveal({
          sessionToken: token,
          seasonId,
          matchId,
        })
      },
      toErrorMessage: getRevealErrorMessage,
    })
  }
  const revealLoader = revealLoaderRef.current

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const applyBundle = useCallback((bundle: CalendarBundle) => {
    setSeason(bundle.season)
    setMatches(bundle.matches)
    setPredictions(bundle.predictions)
    setError(null)
  }, [])

  const reloadRevealsAfterData = useCallback(() => {
    // One coordinated wave after data lands — not before the fetch.
    revealStatesRef.current = revealReducer(revealStatesRef.current, {
      type: 'reset',
    })
    dispatchRevealState({ type: 'reset' })
    revealLoader.resetInFlight()
    for (const matchId of revealableMatchIdsRef.current) {
      void revealLoader.loadReveal(matchId)
    }
  }, [revealLoader])

  const loadCalendarData = useCallback(
    async (mode: 'initial' | 'soft') => {
      if (!sessionToken || !playerId) return
      await loadGuardRef.current.run(async () => {
        const generation = dataGenerationRef.current.next()
        const token = sessionToken

        await runSoftPageLoad({
          mode,
          hasExistingData: hasExistingDataRef.current,
          generation,
          isCurrent: (gen) => dataGenerationRef.current.isCurrent(gen),
          load: async () => {
            const bundle = await loadCalendarBundle({
              sessionToken: token,
              fetchActiveSeason,
              fetchMatches,
              fetchMyPredictions,
            })
            return {
              season: bundle.season as Season,
              matches: bundle.matches as Match[],
              predictions: bundle.predictions as Prediction[],
            }
          },
          onFullLoading: () => {
            setLoading(true)
            setError(null)
          },
          onSoftStart: () => {
            // Keep current list visible; clear only a soft banner error.
            setError(null)
          },
          onSuccess: (bundle) => {
            applyBundle(bundle)
            reloadRevealsAfterData()
          },
          onError: (err) => {
            if (!hasExistingDataRef.current) {
              setError(toUserMessage(err))
            }
          },
          onSettled: () => {
            setLoading(false)
          },
        })
      })
    },
    [applyBundle, playerId, reloadRevealsAfterData, sessionToken],
  )

  useEffect(() => {
    const generation = dataGenerationRef.current
    const guard = loadGuardRef.current
    void loadCalendarData('initial')
    return () => {
      generation.bump()
      guard.reset()
    }
  }, [loadCalendarData])

  function retryInitial() {
    void loadCalendarData('initial')
  }

  const awaitingOfficialResult = useMemo(
    () => hasMatchAwaitingOfficialResult(matches, now),
    [matches, now],
  )

  useEffect(() => {
    if (!sessionToken || !playerId) return

    const attachment = attachSoftPageRefresh({
      onRefresh: () => {
        void loadCalendarData('soft')
      },
      shouldPoll: awaitingOfficialResult,
    })

    return () => attachment.dispose()
  }, [awaitingOfficialResult, loadCalendarData, playerId, sessionToken])

  const revealableMatchIds = useMemo(
    () =>
      matches
        .filter((match) => {
          const withStatus = withPredictionStatus(
            match,
            Boolean(getPredictionForMatch(predictions, match.id, playerId ?? '')),
            now,
          )
          return withStatus.status === 'locked' || withStatus.status === 'finished'
        })
        .map((match) => match.id),
    [matches, now, playerId, predictions],
  )

  useEffect(() => {
    revealableMatchIdsRef.current = revealableMatchIds
  }, [revealableMatchIds])

  // Charge uniquement les ids encore idle — ne cancel pas les loading en cours.
  useEffect(() => {
    if (!sessionToken || !season?.id || revealableMatchIds.length === 0) return
    const idleIds = selectIdleRevealIds(
      revealStatesRef.current,
      revealableMatchIds,
    )
    for (const matchId of idleIds) {
      void revealLoader.loadReveal(matchId)
    }
  }, [revealLoader, revealableMatchIds, season?.id, sessionToken])

  const items = useMemo(() => {
    if (!playerId) return []
    return matches.map((match) => {
      const prediction = getPredictionForMatch(predictions, match.id, playerId)
      return {
        match: withPredictionStatus(match, Boolean(prediction), now),
        prediction,
      }
    })
  }, [matches, predictions, playerId, now])

  const nextOpenId = useMemo(() => {
    const next = findNextOpenMatch(matches, now)
    return next?.id ?? null
  }, [matches, now])

  const lastFinishedId = useMemo(
    () => findLastFinishedMatch(matches)?.id ?? null,
    [matches],
  )

  function isDetailsOpen(matchId: string): boolean {
    if (Object.prototype.hasOwnProperty.call(detailsOpenById, matchId)) {
      return detailsOpenById[matchId]
    }
    return matchId === lastFinishedId
  }

  // Ouvre automatiquement une carte en erreur de reveal.
  useEffect(() => {
    const errorIds = Object.entries(revealStates)
      .filter(([, state]) => state.status === 'error')
      .map(([id]) => id)
    if (errorIds.length === 0) return
    setDetailsOpenById((current) => {
      let changed = false
      const next = { ...current }
      for (const id of errorIds) {
        if (next[id] !== true) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [revealStates])

  useEffect(() => {
    if (!highlightMatchId || matches.length === 0 || !playerId) return
    const target = matches.find((match) => match.id === highlightMatchId)
    if (!target) return
    const prediction = getPredictionForMatch(
      predictions,
      target.id,
      playerId,
    )
    const withStatus = withPredictionStatus(target, Boolean(prediction), now)
    const next = findNextOpenMatch(matches, now)
    if (
      !shouldOpenDetailsForDeepLink({
        matchFound: true,
        uiStatus: withStatus.status,
        isNextOpen: next?.id === highlightMatchId,
      })
    ) {
      return
    }
    setDetailsOpenById((current) =>
      current[highlightMatchId] === true
        ? current
        : { ...current, [highlightMatchId]: true },
    )
  }, [highlightMatchId, matches, now, playerId, predictions])

  useEffect(() => {
    if (!highlightMatchId || matches.length === 0) return
    const target = matches.find((match) => match.id === highlightMatchId)
    if (!target) return
    const desiredTab: CalendarTab =
      target.status === 'finished' || target.dbStatus === 'finished'
        ? 'finished'
        : 'upcoming'
    setTab(desiredTab)
  }, [highlightMatchId, matches])

  useEffect(() => {
    if (loading || !highlightMatchId) return
    // Attend que le tabpanel actif ait monté le nœud cible (évite scroll flaky).
    const el = document.getElementById(`match-${highlightMatchId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [loading, highlightMatchId, tab, items])

  useEffect(() => {
    if (!pendingScrollToNextRef.current || tab !== 'upcoming') return
    const el = document.getElementById('prochain-match')
    if (!el) {
      if (!loading) pendingScrollToNextRef.current = false
      return
    }
    pendingScrollToNextRef.current = false
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [tab, loading, nextOpenId, items])

  useEffect(() => {
    document
      .getElementById(`tab-${tab}`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tab])

  const showInitialLoading = loading && matches.length === 0
  const showInitialError = Boolean(error) && matches.length === 0

  const nextItems = useMemo(
    () =>
      nextOpenId
        ? items.filter(({ match }) => match.id === nextOpenId)
        : [],
    [items, nextOpenId],
  )
  const upcomingItems = useMemo(
    () =>
      items.filter(
        ({ match }) =>
          match.status !== 'finished' && match.id !== nextOpenId,
      ),
    [items, nextOpenId],
  )
  const finishedItems = useMemo(
    () => items.filter(({ match }) => match.status === 'finished'),
    [items],
  )
  /** Tri local décroissant (plus récent en premier) — ne touche pas sortMatchesForList. */
  const finishedItemsNewestFirst = useMemo(
    () => [...finishedItems].reverse(),
    [finishedItems],
  )
  const upcomingDisplayOrderIds = useMemo(
    () => [
      ...nextItems.map(({ match }) => match.id),
      ...upcomingItems.map(({ match }) => match.id),
    ],
    [nextItems, upcomingItems],
  )
  const showJumpInFinished = nextOpenId != null
  const showJumpInUpcoming = shouldShowJumpToNextMatch(
    upcomingDisplayOrderIds,
    nextOpenId,
  )

  function handleJumpToNextMatch(event: MouseEvent<HTMLAnchorElement>) {
    if (tab !== 'finished') return
    event.preventDefault()
    pendingScrollToNextRef.current = true
    setTab('upcoming')
  }

  function renderJumpToNextLink() {
    return (
      <div className="flex justify-end">
        <a
          href="#prochain-match"
          className="text-xs font-extrabold tracking-[0.08em] text-green-dark uppercase"
          onClick={handleJumpToNextMatch}
        >
          Aller au prochain match
        </a>
      </div>
    )
  }

  function renderMatchRow(match: Match, prediction: Prediction | undefined) {
    const revealState = getRevealState(revealStates, match.id)
    return (
      <li key={match.id}>
        <MatchListItem
          match={match}
          prediction={prediction}
          reveal={
            revealState.status === 'success' ? revealState.data : undefined
          }
          revealLoading={revealState.status === 'loading'}
          revealError={
            revealState.status === 'error' ? revealState.error : null
          }
          isNext={match.id === nextOpenId}
          isPredictionTarget={match.id === nextOpenId}
          highlighted={match.id === highlightMatchId}
          detailsOpen={isDetailsOpen(match.id)}
          onDetailsOpenChange={(open) => {
            setDetailsOpenById((current) => ({
              ...current,
              [match.id]: open,
            }))
          }}
          onRetryReveal={() => {
            revealLoader.retryReveal(match.id)
          }}
        />
      </li>
    )
  }

  const hasUpcomingContent = nextItems.length > 0 || upcomingItems.length > 0

  return (
    <div className="page-stack">
      <PageHeader
        title="Calendrier"
        description="Les matchs à venir, tes pronostics et les résultats."
      />

      {showInitialLoading ? (
        <EmptyCard message="Chargement du calendrier…" />
      ) : showInitialError ? (
        <div className="space-y-3">
          <EmptyCard message={error!} tone="error" />
          <button type="button" className="btn-secondary" onClick={retryInitial}>
            Réessayer
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="panel border-dashed p-6 text-center">
          <p className="font-bold text-ink">Aucun match pour l’instant</p>
          <p className="mt-1 text-sm text-muted">
            Le calendrier se remplira dès la prochaine journée.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <TabList
            label="Vues du calendrier"
            value={tab}
            onChange={setTab}
            order={CALENDAR_TAB_ORDER}
          >
            <TabButton
              selected={tab === 'upcoming'}
              onSelect={() => setTab('upcoming')}
              id="tab-upcoming"
              controls="panel-upcoming"
              fill
            >
              À venir
            </TabButton>
            <TabButton
              selected={tab === 'finished'}
              onSelect={() => setTab('finished')}
              id="tab-finished"
              controls="panel-finished"
              fill
            >
              Terminés
            </TabButton>
          </TabList>

          {tab === 'upcoming' ? (
            <div
              role="tabpanel"
              id="panel-upcoming"
              aria-labelledby="tab-upcoming"
              className="space-y-6"
            >
              {showJumpInUpcoming ? renderJumpToNextLink() : null}
              {!hasUpcomingContent ? (
                <EmptyCard message="Aucun match à venir." />
              ) : (
                <>
                  {nextItems.length > 0 ? (
                    <section
                      aria-labelledby="calendar-next-heading"
                      className="space-y-2.5"
                    >
                      <h2
                        id="calendar-next-heading"
                        className="text-[11px] font-bold tracking-[0.12em] text-ink/55 uppercase"
                      >
                        Prochain match
                      </h2>
                      <ul className="space-y-2.5">
                        {nextItems.map(({ match, prediction }) =>
                          renderMatchRow(match, prediction),
                        )}
                      </ul>
                    </section>
                  ) : null}

                  {upcomingItems.length > 0 ? (
                    <section
                      aria-labelledby="calendar-upcoming-heading"
                      className="space-y-2.5"
                    >
                      <h2
                        id="calendar-upcoming-heading"
                        className="text-[11px] font-bold tracking-[0.12em] text-ink/55 uppercase"
                      >
                        Ensuite
                      </h2>
                      <ul className="space-y-2.5">
                        {upcomingItems.map(({ match, prediction }) =>
                          renderMatchRow(match, prediction),
                        )}
                      </ul>
                    </section>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div
              role="tabpanel"
              id="panel-finished"
              aria-labelledby="tab-finished"
              className="space-y-3"
            >
              {showJumpInFinished ? renderJumpToNextLink() : null}
              {finishedItemsNewestFirst.length === 0 ? (
                <EmptyCard message="Aucun match terminé." />
              ) : (
                <section
                  aria-label="Matchs terminés"
                  className="space-y-2.5"
                >
                  <ul className="space-y-2.5">
                    {finishedItemsNewestFirst.map(({ match, prediction }) =>
                      renderMatchRow(match, prediction),
                    )}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function getRevealErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === REVEAL_TIMEOUT_MESSAGE) {
    return REVEAL_TIMEOUT_MESSAGE
  }
  const message = toUserMessage(error)
  if (message === UNKNOWN_USER_MESSAGE) {
    return 'Pronostics collectifs temporairement indisponibles.'
  }
  return message
}

function EmptyCard({
  message,
  tone = 'neutral',
}: {
  message: string
  tone?: 'neutral' | 'error'
}) {
  return (
    <div className="panel p-5">
      <p
        className={[
          'text-sm',
          tone === 'error' ? 'font-semibold text-danger' : 'text-muted',
        ].join(' ')}
      >
        {message}
      </p>
    </div>
  )
}
