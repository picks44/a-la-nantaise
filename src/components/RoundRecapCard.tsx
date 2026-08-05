import { formatRecapMessage } from '../lib/recapMessages'
import {
  formatGapToPreviousHuman,
  formatRankChangeHuman,
} from '../lib/rankingDisplay'
import { pointsResultLabel } from '../lib/status'
import type { PlayerRoundRecap, RecapMessageKey } from '../types'

/** Messages déjà centrés sur le classement : ne pas redire la même chose en niveau 2. */
const RANK_FOCUSED_KEYS: RecapMessageKey[] = [
  'champion_of_round',
  'personal_best_rank',
  'strong_rise',
  'no_participation',
]

export function RoundRecapCard({
  recap,
  onDismiss,
}: {
  recap: PlayerRoundRecap
  onDismiss?: () => void
}) {
  const messageParams = {
    ...recap.messageParams,
    rank: recap.messageParams.rank ?? recap.ranking.rankAfter ?? 0,
    places:
      recap.messageParams.places ??
      (recap.ranking.rankDelta != null
        ? Math.abs(recap.ranking.rankDelta)
        : 0),
    rankDelta: recap.ranking.rankDelta ?? '',
    exactScoreCount:
      recap.messageParams.exactScoreCount ?? recap.summary.exactScoreCount,
  }

  const message = formatRecapMessage(
    recap.messageKey,
    messageParams,
    recap.isDefinitive,
  )

  const isLeader = recap.ranking.rankAfter === 1
  const rankSentence = formatRankChangeHuman({
    rankBefore: recap.ranking.rankBefore,
    rankAfter: recap.ranking.rankAfter,
    rankDelta: recap.ranking.rankDelta,
    isNewToRanking: recap.ranking.isNewToRanking,
    isLeader,
  })
  const gapSentence = formatGapToPreviousHuman(recap.ranking.gapToPrevious, {
    isLeader,
  })
  const skipRankNarrative = RANK_FOCUSED_KEYS.includes(recap.messageKey)

  return (
    <section
      className="panel section-stack overflow-hidden p-4 sm:p-5"
      aria-label="Récap de journée"
    >
      {/* Niveau 1 — résultat principal */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="label-caps">Journée {recap.roundNumber}</p>
          <h2 className="mt-1.5 text-xl font-black leading-snug text-ink sm:text-2xl">
            {message}
          </h2>
          <p className="mt-2 text-3xl font-black tabular-nums text-green-dark">
            {recap.summary.roundPoints}
            <span className="ml-1.5 text-sm font-bold tracking-wide text-muted uppercase">
              pts
            </span>
          </p>
        </div>
        <span className="badge-text border-border bg-surface-muted text-muted">
          {recap.isDefinitive ? 'Définitif' : 'Provisoire'}
        </span>
      </header>

      {/* Niveau 2 — évolution classement */}
      <div className="rounded-[var(--radius-sm)] border border-border bg-canvas/70 px-3 py-3 text-sm">
        {skipRankNarrative ? (
          <p className="font-semibold text-ink">
            {recap.ranking.isNewToRanking
              ? 'Nouveau au classement'
              : recap.ranking.rankAfter != null
                ? `Classement : ${recap.ranking.rankAfter === 1 ? '1re' : `${recap.ranking.rankAfter}e`} place`
                : null}
          </p>
        ) : (
          <p className="font-semibold text-ink">{rankSentence}</p>
        )}
        {gapSentence ? (
          <p className="mt-1 text-xs text-muted sm:text-sm">{gapSentence}</p>
        ) : null}
      </div>

      {/* Niveau 3 — détail journée */}
      <div className="compact-stack">
        <dl className="grid grid-cols-3 gap-3">
          <Stat
            label="Exacts"
            value={String(recap.summary.exactScoreCount)}
          />
          <Stat
            label="Bons résultats"
            value={String(recap.summary.correctOutcomeOnlyCount)}
          />
          <Stat
            label="Sans prono"
            value={String(recap.summary.missedPredictionCount)}
          />
        </dl>

        {recap.summary.participated && recap.matches.length > 0 ? (
          <ul className="compact-stack border-t border-border pt-3">
            {recap.matches.map((match) => (
              <li
                key={match.matchId}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{match.label}</p>
                  <p className="text-xs text-muted">
                    {match.finalScore
                      ? `Score ${match.finalScore.home}-${match.finalScore.away}`
                      : match.status}
                    {match.prediction
                      ? ` · Prono ${match.prediction.home}-${match.prediction.away}`
                      : ' · Non pronostiqué'}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-bold">
                  {match.predicted
                    ? (pointsResultLabel(match.points ?? 0) ?? '—')
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {(recap.social.championDisplayNames.length > 0 ||
          recap.social.participantAveragePoints != null) && (
          <p className="border-t border-border pt-3 text-xs text-muted sm:text-sm">
            {recap.social.championDisplayNames.length > 0
              ? `Champion${recap.social.championDisplayNames.length > 1 ? 's' : ''} : ${recap.social.championDisplayNames.join(', ')}`
              : null}
            {recap.social.participantAveragePoints != null
              ? `${recap.social.championDisplayNames.length > 0 ? ' · ' : ''}Moyenne : ${recap.social.participantAveragePoints} pts`
              : null}
          </p>
        )}

        {recap.trophies.length > 0 ? (
          <ul className="flex flex-wrap gap-2 pt-1">
            {recap.trophies.map((trophy) => (
              <li
                key={`${trophy.trophyKey}-${trophy.sourceMatchId ?? 'x'}`}
                className="badge-text border-green/30 bg-success-soft text-green-dark"
              >
                {trophy.name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {onDismiss ? (
        <button
          type="button"
          className="btn-secondary w-full"
          onClick={onDismiss}
        >
          Fermer
        </button>
      ) : null}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-black tabular-nums">{value}</dd>
    </div>
  )
}
