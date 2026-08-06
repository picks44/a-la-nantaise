import {
  buildRoundAnnotations,
  formatTimelinePoints,
  formatTimelineRoundLine,
  isTimelineMilestone,
} from '../lib/seasonTimeline'
import { formatRankOrdinal } from '../lib/rankingDisplay'
import type { SeasonTimeline } from '../types'

export function SeasonTimelinePanel({
  timeline,
}: {
  timeline: SeasonTimeline
}) {
  const trophiesByRound = new Map<number, typeof timeline.trophies>()
  for (const trophy of timeline.trophies) {
    if (trophy.sourceRoundNumber == null) continue
    const list = trophiesByRound.get(trophy.sourceRoundNumber) ?? []
    list.push(trophy)
    trophiesByRound.set(trophy.sourceRoundNumber, list)
  }

  const finishedCount = timeline.rounds.length
  const finishedLabel =
    finishedCount <= 1
      ? `${finishedCount} journée`
      : `${finishedCount} journées`

  return (
    <section
      className="panel section-stack overflow-hidden p-3 pb-3 sm:p-4"
      aria-label="Parcours de saison"
    >
      <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2 sm:grid-cols-3 sm:gap-2">
        <div className="px-1 py-0.5 sm:px-2 sm:py-1">
          <p className="label-caps">Journées terminées</p>
          <p className="mt-0.5 text-base font-black tabular-nums sm:mt-1 sm:text-xl">
            {finishedLabel}
          </p>
        </div>
        {timeline.bestRound ? (
          <div className="px-1 py-0.5 sm:px-2 sm:py-1">
            <p className="label-caps">Meilleure journée</p>
            <p className="mt-0.5 text-base font-black sm:mt-1 sm:text-xl">
              J{timeline.bestRound.roundNumber} ·{' '}
              {formatTimelinePoints(timeline.bestRound.roundPoints)}
            </p>
          </div>
        ) : null}
        {timeline.bestRank ? (
          <div className="px-1 py-0.5 sm:px-2 sm:py-1">
            <p className="label-caps">Meilleure position</p>
            <p className="mt-0.5 text-base font-black sm:mt-1 sm:text-xl">
              {formatRankOrdinal(timeline.bestRank.rank)} · J
              {timeline.bestRank.roundNumber}
            </p>
          </div>
        ) : null}
      </div>

      <ol className="season-timeline">
        {timeline.rounds.map((round) => {
          const isBestRound =
            timeline.bestRound?.roundNumber === round.roundNumber
          const isBestRank =
            timeline.bestRank?.roundNumber === round.roundNumber
          const roundTrophies = trophiesByRound.get(round.roundNumber) ?? []
          const milestone = isTimelineMilestone({
            isBestRound,
            isBestRank,
            trophyCount: roundTrophies.length,
          })
          const annotations = buildRoundAnnotations({
            isBestRound,
            isBestRank,
            trophyNames: roundTrophies.map((trophy) => trophy.name),
          })
          const line = formatTimelineRoundLine({
            roundNumber: round.roundNumber,
            roundPoints: round.roundPoints,
            rank: round.rank,
          })

          return (
            <li
              key={round.roundNumber}
              className={[
                'season-timeline-item',
                milestone ? 'season-timeline-item--milestone' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="season-timeline-marker" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {line}
                </p>
                {annotations.length > 0 ? (
                  <p className="mt-1 text-xs font-medium leading-relaxed text-ink/60">
                    {annotations.join(' · ')}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      {timeline.trophies.some((t) => t.sourceRoundNumber == null) ? (
        <div className="border-t border-border/60 pt-3">
          <p className="label-caps mb-2">Autres moments de la saison</p>
          <p className="text-xs font-medium leading-relaxed text-ink/65">
            {timeline.trophies
              .filter((t) => t.sourceRoundNumber == null)
              .map((trophy) => trophy.name)
              .join(' · ')}
          </p>
        </div>
      ) : null}
    </section>
  )
}
