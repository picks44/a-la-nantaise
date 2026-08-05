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
                <span className="label-caps shrink-0">
                  Votre pronostic
                </span>
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
}: {
  match: Match
  reveal?: MatchGroupReveal
  loading: boolean
  error: string | null
}) {
  if (match.status === 'to_predict') return null

  const isBeforeReveal =
    match.status === 'predicted' || match.status === 'kickoff_unconfirmed'

  if (isBeforeReveal) {
    return (
      <div className="mt-3 border-t border-border pt-3 text-sm text-muted">
        <p className="font-semibold text-ink">Les pronos du groupe</p>
        <p className="mt-1">
          Les pronostics des autres seront reveles automatiquement au coup
          d’envoi.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="mt-3 border-t border-border pt-3 text-sm text-muted transition-all duration-300">
        Chargement des pronostics du groupe…
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-3 border-t border-border pt-3 text-sm text-danger transition-all duration-300">
        {error}
      </div>
    )
  }

  if (!reveal?.revealed) {
    return (
      <div className="mt-3 border-t border-border pt-3 text-sm text-muted transition-all duration-300">
        Pronostics collectifs encore verrouilles.
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

  return (
    <section className="mt-3 space-y-3 border-t border-border pt-3 transition-all duration-300">
      <div className="space-y-1">
        <p className="font-semibold text-ink">Les pronos du groupe</p>
        {participantCount === 0 ? (
          <p className="text-sm text-muted">
            Aucun autre prono visible pour ce match pour le moment.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <StatChip
              label="Participants"
              value={String(participantCount)}
            />
            <StatChip
              label="Sans prono"
              value={String(nonParticipantCount)}
            />
            <StatChip
              label="Score le plus joue"
              value={mostPlayed.length > 0 ? mostPlayed.join(', ') : '—'}
            />
            <StatChip
              label="Pronos uniques"
              value={uniqueScores.length > 0 ? uniqueScores.join(', ') : 'Aucun'}
            />
          </div>
        )}
      </div>

      {participantCount > 0 && reveal.percentages ? (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <StatChip
            label="Victoire"
            value={`${reveal.percentages.victory}%`}
          />
          <StatChip label="Nul" value={`${reveal.percentages.draw}%`} />
          <StatChip
            label="Defaite"
            value={`${reveal.percentages.defeat}%`}
          />
        </div>
      ) : null}

      {participants.length > 0 ? (
        <ul className="space-y-2">
          {participants.map((participant) => (
            <li
              key={participant.playerId}
              className="rounded-[var(--radius-sm)] border border-border bg-canvas/70 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-ink">{participant.pseudo}</p>
                <div className="flex flex-wrap gap-1">
                  <span className="badge">{participant.outcome}</span>
                  {reveal.resultReady && participant.points != null ? (
                    <span className="badge border-green bg-success-soft text-green-dark">
                      {participant.points} pt{participant.points > 1 ? 's' : ''}
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
              <p className="mt-1 text-sm font-black tabular-nums text-ink">
                {participant.homeScore} – {participant.awayScore}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {reveal.resultReady && performance.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-bold tracking-[0.08em] text-muted uppercase">
            Classement du match
          </p>
          <ul className="space-y-1 text-sm">
            {performance.map((row) => (
              <li
                key={row.playerId}
                className="flex items-center justify-between rounded-[var(--radius-sm)] border border-border px-3 py-2"
              >
                <span className="font-medium text-ink">
                  #{row.rank} {row.pseudo}
                </span>
                <span className="font-black tabular-nums text-green-dark">
                  {row.points} pt{row.points > 1 ? 's' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {trophies.length > 0 ? (
        <div className="rounded-[var(--radius-sm)] border border-yellow/60 bg-yellow/20 px-3 py-2 text-sm">
          <p className="font-bold text-ink">Nouveaux trophees sur ce match</p>
          <ul className="mt-1 space-y-1 text-ink/80">
            {trophies.map((trophy) => (
              <li key={`${trophy.playerId}-${trophy.trophyKey}`}>
                {trophy.pseudo} · {trophy.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-canvas/70 px-2.5 py-2">
      <p className="text-[10px] font-bold tracking-[0.08em] text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 font-black text-ink">{value}</p>
    </div>
  )
}
