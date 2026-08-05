import { Link } from 'react-router-dom'
import type { Match, MatchGroupReveal, Prediction } from '../types'
import {
  formatMatchDateShort,
  formatMatchTime,
  venueSecondaryLabel,
} from '../lib/format'
import { pointsResultLabel, statusClassName, statusLabel } from '../lib/status'

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
  const isPredicted = match.status === 'predicted'
  const isUnconfirmed = match.status === 'kickoff_unconfirmed'
  const shouldLinkToPrediction =
    match.status === 'to_predict' && isPredictionTarget
  const canShowModifier =
    match.status === 'predicted' && isPredictionTarget && Boolean(prediction)
  const stadium = venueSecondaryLabel(match.venue)
  const resultLabel = pointsResultLabel(prediction?.points)

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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-white/15 bg-white/5 px-3 py-2 text-sm">
            <p>
              <span className="text-[10px] font-bold tracking-wider text-white/50 uppercase">
                Ton prono
              </span>
              <span className="mt-0.5 block font-bold tabular-nums">
                {prediction
                  ? `${prediction.homeScore} – ${prediction.awayScore}`
                  : 'Aucun'}
              </span>
            </p>
            {resultLabel ? (
              <span className="badge border-yellow bg-yellow text-ink">
                {resultLabel}
              </span>
            ) : (
              <span className="text-xs text-white/50">—</span>
            )}
          </div>
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
  if (match.status === 'to_predict') return null

  const isBeforeReveal =
    match.status === 'predicted' || match.status === 'kickoff_unconfirmed'
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
  const participantCount = reveal.participantCount ?? participants.length
  const nonParticipantCount = reveal.nonParticipantCount ?? 0
  const mostPlayed = reveal.mostPlayedScores ?? []
  const uniqueScores = reveal.uniqueScores ?? []
  const trophies = reveal.newTrophies ?? []
  const performance = reveal.performanceRanking ?? []
  const hasExpandableDetails =
    participants.length > 0 ||
    (reveal.resultReady && performance.length > 0) ||
    trophies.length > 0

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
                'min-h-9 rounded-[var(--radius-sm)] border px-2.5 text-xs font-extrabold tracking-[0.06em] uppercase',
                isFinishedShell
                  ? 'border-white/25 text-yellow'
                  : 'border-border text-green-dark',
              ].join(' ')}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => onDetailsOpenChange(!detailsOpen)}
            >
              {detailsOpen ? 'Masquer' : 'Détails'}
            </button>
          ) : null}
        </div>

        {participantCount === 0 ? (
          <p className={`text-sm ${mutedClass}`}>
            Aucun autre prono visible pour ce match pour le moment.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <StatChip
              label="Participants"
              value={String(participantCount)}
              onDark={isFinishedShell}
            />
            <StatChip
              label="Sans prono"
              value={String(nonParticipantCount)}
              onDark={isFinishedShell}
            />
            <StatChip
              label="Score le plus joue"
              value={mostPlayed.length > 0 ? mostPlayed.join(', ') : '—'}
              onDark={isFinishedShell}
            />
            <StatChip
              label="Pronos uniques"
              value={uniqueScores.length > 0 ? uniqueScores.join(', ') : 'Aucun'}
              onDark={isFinishedShell}
            />
          </div>
        )}

        {participantCount > 0 && reveal.percentages ? (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <StatChip
              label="Victoire"
              value={`${reveal.percentages.victory}%`}
              onDark={isFinishedShell}
            />
            <StatChip
              label="Nul"
              value={`${reveal.percentages.draw}%`}
              onDark={isFinishedShell}
            />
            <StatChip
              label="Defaite"
              value={`${reveal.percentages.defeat}%`}
              onDark={isFinishedShell}
            />
          </div>
        ) : null}
      </div>

      {hasExpandableDetails ? (
        <div
          id={detailsId}
          hidden={!detailsOpen}
          className={detailsOpen ? 'space-y-3' : undefined}
        >
          {participants.length > 0 ? (
            <ul className="space-y-2">
              {participants.map((participant) => (
                <li
                  key={participant.playerId}
                  className={[
                    'rounded-[var(--radius-sm)] border px-3 py-2 text-sm',
                    isFinishedShell
                      ? 'border-white/15 bg-white/5'
                      : 'border-border bg-canvas/70',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`font-semibold ${titleClass}`}>
                      {participant.pseudo}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      <span className="badge">{participant.outcome}</span>
                      {reveal.resultReady && participant.points != null ? (
                        <span className="badge border-green bg-success-soft text-green-dark">
                          {participant.points} pt
                          {participant.points > 1 ? 's' : ''}
                        </span>
                      ) : null}
                      {reveal.resultReady && participant.exactScore ? (
                        <span className="badge border-yellow bg-yellow text-ink">
                          Score exact
                        </span>
                      ) : null}
                      {reveal.resultReady && participant.bestPrediction ? (
                        <span className="badge border-green-dark bg-green-dark text-yellow">
                          Meilleur prono
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p
                    className={[
                      'mt-1 text-sm font-black tabular-nums',
                      titleClass,
                    ].join(' ')}
                  >
                    {participant.homeScore} – {participant.awayScore}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          {reveal.resultReady && performance.length > 0 ? (
            <div className="space-y-2">
              <p
                className={[
                  'text-xs font-bold tracking-[0.08em] uppercase',
                  mutedClass,
                ].join(' ')}
              >
                Classement du match
              </p>
              <ul className="space-y-1 text-sm">
                {performance.map((row) => (
                  <li
                    key={row.playerId}
                    className={[
                      'flex items-center justify-between rounded-[var(--radius-sm)] border px-3 py-2',
                      isFinishedShell
                        ? 'border-white/15'
                        : 'border-border',
                    ].join(' ')}
                  >
                    <span className={`font-medium ${titleClass}`}>
                      #{row.rank} {row.pseudo}
                    </span>
                    <span
                      className={[
                        'font-black tabular-nums',
                        isFinishedShell ? 'text-yellow' : 'text-green-dark',
                      ].join(' ')}
                    >
                      {row.points} pt{row.points > 1 ? 's' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trophies.length > 0 ? (
            <div
              className={[
                'rounded-[var(--radius-sm)] border px-3 py-2 text-sm',
                isFinishedShell
                  ? 'border-yellow/60 bg-yellow/15 text-white'
                  : 'border-yellow/60 bg-yellow/20 text-ink',
              ].join(' ')}
            >
              <p className="font-bold">Nouveaux trophees sur ce match</p>
              <ul className="mt-1 space-y-1 opacity-90">
                {trophies.map((trophy) => (
                  <li key={`${trophy.playerId}-${trophy.trophyKey}`}>
                    {trophy.pseudo} · {trophy.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function StatChip({
  label,
  value,
  onDark = false,
}: {
  label: string
  value: string
  onDark?: boolean
}) {
  return (
    <div
      className={[
        'rounded-[var(--radius-sm)] border px-2.5 py-2',
        onDark ? 'border-white/15 bg-white/5' : 'border-border bg-canvas/70',
      ].join(' ')}
    >
      <p
        className={[
          'text-[10px] font-bold tracking-[0.08em] uppercase',
          onDark ? 'text-white/55' : 'text-muted',
        ].join(' ')}
      >
        {label}
      </p>
      <p
        className={[
          'mt-1 font-black',
          onDark ? 'text-white' : 'text-ink',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}
