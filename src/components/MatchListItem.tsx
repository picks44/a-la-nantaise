import type { Match, Prediction } from '../types'
import {
  formatMatchDateShort,
  formatMatchTime,
  venueSecondaryLabel,
} from '../lib/format'
import { pointsResultLabel, statusClassName, statusLabel } from '../lib/status'

interface MatchListItemProps {
  match: Match
  prediction?: Prediction
  /** Prochain match ouvert aux pronostics — seul fond jaune dominant. */
  isNext?: boolean
}

export function MatchListItem({
  match,
  prediction,
  isNext = false,
}: MatchListItemProps) {
  const isFinished = match.status === 'finished'
  const isPredicted = match.status === 'predicted'
  const stadium = venueSecondaryLabel(match.venue)
  const resultLabel = pointsResultLabel(prediction?.points)

  const shellClass = isNext
    ? 'border-ink bg-yellow'
    : isFinished
      ? 'border-ink bg-ink text-white'
      : 'border-border bg-surface'

  return (
    <article
      id={isNext ? 'prochain-match' : undefined}
      className={[
        'overflow-hidden rounded-[var(--radius-md)] border scroll-mt-20',
        shellClass,
      ].join(' ')}
    >
      <div
        className={[
          'flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2',
          isNext
            ? 'border-ink/15'
            : isFinished
              ? 'border-white/15'
              : 'border-border',
        ].join(' ')}
      >
        <p
          className={[
            'text-[11px] font-bold tracking-[0.08em] uppercase',
            isFinished ? 'text-white/60' : 'text-ink/65',
          ].join(' ')}
        >
          Journée {match.matchday}
          <span className="mx-1.5 opacity-40">·</span>
          {formatMatchDateShort(match.kickoffAt)}{' '}
          {formatMatchTime(match.kickoffAt)}
        </p>
        <span className={['badge', statusClassName(match.status)].join(' ')}>
          {isNext && match.status === 'to_predict'
            ? 'Prochain'
            : statusLabel(match.status)}
        </span>
      </div>

      <div className="px-3 py-3">
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
              'text-right text-sm font-black tracking-tight uppercase sm:text-base',
              isFinished ? 'text-white' : 'text-ink',
            ].join(' ')}
          >
            {match.homeTeam}
          </p>

          <div className="min-w-[4rem] text-center">
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
                  isNext ? 'text-ink/35' : 'text-muted',
                ].join(' ')}
              >
                vs
              </p>
            )}
          </div>

          <p
            className={[
              'text-left text-sm font-black tracking-tight uppercase sm:text-base',
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
          <p
            className={[
              'mt-2.5 border-t pt-2.5 text-sm',
              isNext ? 'border-ink/15 text-ink/75' : 'border-border text-muted',
            ].join(' ')}
          >
            Pronostic :{' '}
            <span
              className={[
                'font-black tabular-nums',
                isPredicted ? 'text-green-dark' : 'text-ink',
              ].join(' ')}
            >
              {prediction.homeScore} – {prediction.awayScore}
            </span>
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
      </div>
    </article>
  )
}
