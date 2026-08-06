import { Link } from 'react-router-dom'
import type { Match, MatchGroupReveal, Prediction } from '../types'
import {
  formatCalendarPersonalPrediction,
  formatCalendarPoints,
  formatFutureMatchMeta,
  formatParticipantPointsLabel,
  formatParticipantPredictionScore,
  formatSavedPrediction,
  selectClosedGroupSummary,
  selectParticipantBadge,
} from '../lib/calendarDisplay'
import {
  formatMatchDateShort,
  formatMatchTime,
  venueSecondaryLabel,
} from '../lib/format'
import { statusClassName, statusLabel } from '../lib/status'

interface MatchListItemProps {
  match: Match
  prediction?: Prediction
  reveal?: MatchGroupReveal
  revealLoading?: boolean
  revealError?: string | null
  /** Prochain match ouvert aux pronostics — seul fond jaune dominant. */
  isNext?: boolean
  /** Match ciblé par le parcours de saisie / édition depuis l'onglet Accueil. */
  isPredictionTarget?: boolean
  /** Deep link depuis une notification (`?match=`). */
  highlighted?: boolean
  /** Détails groupe ouverts (contrôlé par le parent, indexé par matchId). */
  detailsOpen?: boolean
  onDetailsOpenChange?: (open: boolean) => void
  onRetryReveal?: () => void
}

export function MatchListItem({
  match,
  prediction,
  reveal,
  revealLoading = false,
  revealError = null,
  isNext = false,
  isPredictionTarget = false,
  highlighted = false,
  detailsOpen = false,
  onDetailsOpenChange,
  onRetryReveal,
}: MatchListItemProps) {
  const isFinished = match.status === 'finished'
  const isCompactFuture = !isFinished && !isNext
  const isPredicted = match.status === 'predicted'
  const isUnconfirmed = match.status === 'kickoff_unconfirmed'
  const shouldLinkToPrediction =
    match.status === 'to_predict' && isPredictionTarget
  const canShowModifier =
    match.status === 'predicted' && isPredictionTarget && Boolean(prediction)
  const stadium = venueSecondaryLabel(match.venue)

  if (isCompactFuture) {
    const meta = formatFutureMatchMeta({
      matchday: match.matchday,
      kickoffAt: match.kickoffAt,
      status: match.status,
      kickoffTimeConfirmed: match.kickoffTimeConfirmed,
    })
    const savedPrediction =
      match.status === 'predicted' || match.status === 'locked'
        ? formatSavedPrediction(
            prediction
              ? {
                  homeScore: prediction.homeScore,
                  awayScore: prediction.awayScore,
                }
              : null,
          )
        : null
    const compactShell = highlighted
      ? 'border-green bg-success-soft ring-2 ring-green/40'
      : 'border-border bg-surface'

    return (
      <article
        id={`match-${match.id}`}
        data-match-id={match.id}
        className={[
          'future-match-row scroll-mt-24 ui-motion rounded-[var(--radius-sm)] border',
          compactShell,
        ].join(' ')}
        aria-label={`${match.homeTeam} contre ${match.awayTeam}, ${statusLabel(match.status)}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 text-[11px] font-semibold tracking-[0.04em] text-ink/65 uppercase">
            {meta}
          </p>
          <span
            className={[
              'badge shrink-0',
              statusClassName(match.status),
            ].join(' ')}
          >
            {statusLabel(match.status)}
          </span>
        </div>
        <p className="mt-1 min-w-0 text-sm font-semibold leading-snug text-balance text-ink">
          <span>{match.homeTeam}</span>
          <span className="mx-1.5 font-bold text-ink/35">·</span>
          <span>{match.awayTeam}</span>
        </p>
        {savedPrediction ? (
          <p className="mt-1 text-sm font-semibold tabular-nums text-ink/75">
            {savedPrediction}
          </p>
        ) : null}
      </article>
    )
  }

  // Jaune fort réservé au prochain match encore à jouer ; prono enregistré = surface claire.
  const shellClass = highlighted
    ? 'border-green bg-success-soft ring-2 ring-green/40'
    : isFinished
      ? 'border-green-dark bg-green-dark text-white'
      : isPredicted
        ? 'border-green/35 bg-yellow-soft'
        : isNext
          ? 'border-ink bg-yellow'
          : 'border-border bg-surface'

  const cardClassName = [
    'overflow-hidden rounded-[var(--radius-md)] border scroll-mt-24 ui-motion',
    shellClass,
  ].join(' ')

  const cardInner = (
    <>
      {isNext ? <span id="prochain-match" className="sr-only" /> : null}
      <div
        className={[
          'flex flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5 sm:py-2',
          isNext && !isPredicted
            ? 'border-ink/15'
            : isFinished
              ? 'border-white/15'
              : 'border-border',
        ].join(' ')}
      >
        <p
          className={[
            'text-[11px] font-semibold tracking-[0.06em] uppercase',
            isFinished ? 'text-white/70' : 'text-ink/65',
          ].join(' ')}
        >
          Journée {match.matchday}
          <span className="mx-1.5 opacity-40">·</span>
          {formatMatchDateShort(match.kickoffAt)}
          {isUnconfirmed ? (
            ' · Horaire à confirmer'
          ) : (
            <> {formatMatchTime(match.kickoffAt)}</>
          )}
        </p>
        <span className={['badge', statusClassName(match.status)].join(' ')}>
          {isNext && match.status === 'to_predict'
            ? 'Prochain'
            : statusLabel(match.status)}
        </span>
      </div>

      <div className="px-3 py-2.5 sm:py-3">
        <p
          className={[
            'mb-1.5 text-center text-[10px] font-bold tracking-[0.12em] uppercase',
            isFinished ? 'text-yellow' : 'text-green-dark',
          ].join(' ')}
        >
          {stadium}
        </p>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <p
            className={[
              'text-right text-sm font-semibold leading-snug text-balance sm:text-[0.9375rem]',
              isFinished ? 'text-white' : 'text-ink',
            ].join(' ')}
          >
            {match.homeTeam}
          </p>

          <div className="min-w-[3.5rem] text-center sm:min-w-[4rem]">
            {isFinished && match.finalScore ? (
              <p className="font-black text-yellow tabular-nums text-xl">
                {match.finalScore.home}
                <span className="mx-1 text-white/40">–</span>
                {match.finalScore.away}
              </p>
            ) : (
              <p
                className={[
                  'text-lg font-black',
                  isNext && !isPredicted ? 'text-ink/35' : 'text-muted',
                ].join(' ')}
              >
                vs
              </p>
            )}
          </div>

          <p
            className={[
              'text-left text-sm font-semibold leading-snug text-balance sm:text-[0.9375rem]',
              isFinished ? 'text-white' : 'text-ink',
            ].join(' ')}
          >
            {match.awayTeam}
          </p>
        </div>

        {isFinished ? (
          <p className="mt-3 text-sm font-semibold tabular-nums text-white">
            {formatCalendarPersonalPrediction(
              prediction
                ? {
                    homeScore: prediction.homeScore,
                    awayScore: prediction.awayScore,
                    points: prediction.points,
                  }
                : null,
            )}
          </p>
        ) : null}

        {(match.status === 'predicted' || match.status === 'locked') &&
        prediction ? (
          <div className="mt-2.5 rounded-[var(--radius-sm)] border border-border bg-canvas/70 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-baseline gap-3">
                <span className="label-caps shrink-0">Votre pronostic</span>
                <span className="font-black tabular-nums text-green-dark text-lg">
                  {prediction.homeScore} – {prediction.awayScore}
                </span>
              </div>
              {canShowModifier ? (
                <Link
                  to="/"
                  className="btn-ghost min-h-10 whitespace-nowrap"
                  aria-label="Modifier votre pronostic"
                >
                  Modifier
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        {isUnconfirmed ? (
          <p className="mt-2.5 border-t border-border pt-2.5 text-sm text-muted">
            Horaire à confirmer — les pronostics ouvriront bientôt.
          </p>
        ) : null}

        {match.status === 'postponed' ? (
          <p className="mt-2.5 border-t border-border pt-2.5 text-sm text-muted">
            Match reporté — nouveau créneau à venir.
          </p>
        ) : null}

        {match.status === 'cancelled' ? (
          <p className="mt-2.5 border-t border-border pt-2.5 text-sm text-muted">
            Match annulé — aucun point attribué.
          </p>
        ) : null}

        {match.status !== 'cancelled' && match.status !== 'postponed' ? (
          <RevealSection
            match={match}
            reveal={reveal}
            loading={revealLoading}
            error={revealError}
            detailsOpen={detailsOpen}
            onDetailsOpenChange={onDetailsOpenChange}
            onRetryReveal={onRetryReveal}
          />
        ) : null}
      </div>
    </>
  )

  if (shouldLinkToPrediction) {
    return (
      <Link
        to="/"
        id={`match-${match.id}`}
        data-match-id={match.id}
        className={cardClassName}
        aria-label="Ouvrir la saisie du pronostic"
      >
        {cardInner}
      </Link>
    )
  }

  return (
    <article
      id={`match-${match.id}`}
      data-match-id={match.id}
      className={cardClassName}
    >
      {cardInner}
    </article>
  )
}

function RevealSection({
  match,
  reveal,
  loading,
  error,
  detailsOpen,
  onDetailsOpenChange,
  onRetryReveal,
}: {
  match: Match
  reveal?: MatchGroupReveal
  loading: boolean
  error: string | null
  detailsOpen: boolean
  onDetailsOpenChange?: (open: boolean) => void
  onRetryReveal?: () => void
}) {
  if (match.status === 'to_predict' || match.status === 'kickoff_unconfirmed') {
    return null
  }

  const isBeforeReveal = match.status === 'predicted'
  const detailsId = `reveal-details-${match.id}`
  const isFinishedShell = match.status === 'finished'
  const borderClass = isFinishedShell ? 'border-white/15' : 'border-border'
  const titleClass = isFinishedShell ? 'text-white' : 'text-ink'
  const mutedClass = isFinishedShell ? 'text-white/70' : 'text-muted'

  if (isBeforeReveal) {
    return (
      <div className={`mt-3 border-t ${borderClass} pt-3 text-sm ${mutedClass}`}>
        <p className={`font-semibold ${titleClass}`}>Les pronos du groupe</p>
        <p className="mt-1">
          Les pronostics des autres seront reveles automatiquement au coup
          d’envoi.
        </p>
      </div>
    )
  }

  function RevealError({ className }: { className?: string }) {
    if (!error) return null
    return (
      <div
        className={[
          'text-sm',
          isFinishedShell ? 'text-yellow' : 'text-danger',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        role="alert"
      >
        <p>{error}</p>
        {onRetryReveal ? (
          <button
            type="button"
            className={[
              'mt-2 text-xs font-extrabold tracking-[0.06em] uppercase underline-offset-2 hover:underline',
              isFinishedShell ? 'text-yellow' : 'text-green-dark',
            ].join(' ')}
            onClick={onRetryReveal}
          >
            Réessayer
          </button>
        ) : null}
      </div>
    )
  }

  if (loading) {
    return (
      <div
        className={`mt-3 space-y-2 border-t ${borderClass} pt-3 text-sm ${mutedClass} transition-all duration-300`}
      >
        <RevealError />
        <p>Chargement des pronostics du groupe…</p>
      </div>
    )
  }

  if (error && !reveal) {
    return (
      <div className={`mt-3 border-t ${borderClass} pt-3`}>
        <RevealError />
      </div>
    )
  }

  if (!reveal?.revealed) {
    return (
      <div
        className={`mt-3 space-y-2 border-t ${borderClass} pt-3 text-sm ${mutedClass} transition-all duration-300`}
      >
        <RevealError />
        <p>Pronostics collectifs encore verrouilles.</p>
      </div>
    )
  }

  const participants = reveal.participants ?? []
  const trophies = reveal.newTrophies ?? []
  const performance = reveal.performanceRanking ?? []
  const groupSummary = selectClosedGroupSummary(reveal)
  const hasExpandableDetails =
    participants.length > 0 ||
    (reveal.resultReady && performance.length > 0) ||
    trophies.length > 0

  /* Détail ouvert : texte sombre sur surface claire (résumé terminé reste vert). */
  const panelTitleClass = isFinishedShell ? 'text-ink' : titleClass
  const panelMutedClass = isFinishedShell ? 'text-muted' : mutedClass

  return (
    <section
      className={`mt-3 space-y-2 border-t ${borderClass} pt-3 transition-all duration-300`}
    >
      <RevealError />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`font-semibold ${titleClass}`}>Les pronos du groupe</p>
          {hasExpandableDetails && onDetailsOpenChange ? (
            <button
              type="button"
              className={[
                'min-h-11 rounded-[var(--radius-sm)] border px-2.5 text-xs font-extrabold tracking-[0.06em] uppercase',
                isFinishedShell
                  ? 'border-white/25 text-yellow'
                  : 'border-border text-green-dark',
              ].join(' ')}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => onDetailsOpenChange(!detailsOpen)}
            >
              {detailsOpen ? 'Masquer les détails' : 'Afficher les détails'}
            </button>
          ) : null}
        </div>

        {groupSummary.length > 0 ? (
          <p className={`text-sm leading-relaxed ${mutedClass}`}>
            {groupSummary.join(' · ')}
          </p>
        ) : (
          <p className={`text-sm ${mutedClass}`}>
            Aucun autre prono visible pour ce match pour le moment.
          </p>
        )}
      </div>

      {hasExpandableDetails ? (
        <div
          id={detailsId}
          hidden={!detailsOpen}
          className={[
            detailsOpen ? 'space-y-5' : undefined,
            isFinishedShell && detailsOpen
              ? 'match-reveal-details -mx-3 -mb-2.5 mt-3 px-3 pt-3 pb-3 sm:-mb-3'
              : detailsOpen
                ? 'mt-3'
                : undefined,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {participants.length > 0 || trophies.length > 0 ? (
            <section
              className="space-y-2"
              aria-labelledby={`group-predictions-${match.id}`}
            >
              <h4
                id={`group-predictions-${match.id}`}
                className={[
                  'text-xs font-bold tracking-[0.08em] uppercase',
                  panelMutedClass,
                ].join(' ')}
              >
                Pronostics du groupe
              </h4>

              {participants.length > 0 ? (
                <ul className="divide-y divide-border/60">
                  {participants.map((participant) => {
                    const badge = reveal.resultReady
                      ? selectParticipantBadge({
                          exactScore: participant.exactScore,
                          bestPrediction: participant.bestPrediction,
                        })
                      : null
                    const pointsLabel = formatParticipantPointsLabel(
                      participant.points,
                      Boolean(reveal.resultReady),
                    )
                    const scoreLabel = formatParticipantPredictionScore({
                      homeScore: participant.homeScore,
                      awayScore: participant.awayScore,
                    })

                    return (
                      <li
                        key={participant.playerId}
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <span
                          className={[
                            'min-w-0 flex-1 truncate font-semibold',
                            panelTitleClass,
                          ].join(' ')}
                        >
                          {participant.pseudo}
                        </span>
                        <span
                          className={[
                            'shrink-0 font-bold tabular-nums',
                            panelTitleClass,
                          ].join(' ')}
                        >
                          {scoreLabel}
                        </span>
                        {pointsLabel ? (
                          <span
                            className={[
                              'shrink-0 font-semibold tabular-nums',
                              panelMutedClass,
                            ].join(' ')}
                          >
                            {pointsLabel}
                          </span>
                        ) : null}
                        {badge ? (
                          <span className="badge shrink-0 border-yellow bg-yellow text-ink">
                            {badge}
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}

              {trophies.length > 0 ? (
                <div className="match-reveal-trophies">
                  <h5
                    id={`match-trophies-${match.id}`}
                    className={[
                      'text-[11px] font-bold tracking-[0.08em] uppercase',
                      panelMutedClass,
                    ].join(' ')}
                  >
                    Trophées obtenus sur ce match
                  </h5>
                  <ul
                    className={[
                      'mt-1 space-y-0.5 text-sm',
                      panelTitleClass,
                    ].join(' ')}
                  >
                    {trophies.map((trophy) => (
                      <li key={`${trophy.playerId}-${trophy.trophyKey}`}>
                        {trophy.pseudo} · {trophy.name}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {reveal.resultReady && performance.length > 0 ? (
            <section
              className="space-y-1"
              aria-labelledby={`match-ranking-${match.id}`}
            >
              <h4
                id={`match-ranking-${match.id}`}
                className={[
                  'text-xs font-bold tracking-[0.08em] uppercase',
                  panelMutedClass,
                ].join(' ')}
              >
                Classement du match
              </h4>
              <ol className="list-none space-y-0 p-0 text-sm">
                {performance.map((row) => (
                  <li
                    key={row.playerId}
                    className="flex items-baseline justify-between gap-3 py-0.5"
                  >
                    <span
                      className={['min-w-0 truncate', panelTitleClass].join(
                        ' ',
                      )}
                    >
                      <span className="font-semibold tabular-nums">
                        {row.rank}.
                      </span>{' '}
                      {row.pseudo}
                    </span>
                    <span
                      className={[
                        'shrink-0 font-semibold tabular-nums',
                        panelMutedClass,
                      ].join(' ')}
                    >
                      {formatCalendarPoints(row.points)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
