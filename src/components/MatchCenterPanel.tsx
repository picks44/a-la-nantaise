import { providerStatusLabelFr } from '../lib/providerStatus'
import type { MatchCenterData, MatchCenterEvent } from '../lib/matchCenter'

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function countdownLabel(kickoffAt: string, now = Date.now()): string {
  const delta = new Date(kickoffAt).getTime() - now
  if (delta <= 0) return 'Coup d’envoi passé'
  const minutes = Math.floor(delta / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `Dans ${days} j ${hours % 24} h`
  if (hours > 0) return `Dans ${hours} h ${minutes % 60} min`
  return `Dans ${minutes} min`
}

function eventLabel(event: MatchCenterEvent): string {
  const type = event.event_type.toLowerCase()
  if (type === 'goal') return 'But'
  if (type === 'card' && event.detail?.toLowerCase().includes('yellow')) {
    return 'Carton jaune'
  }
  if (type === 'card') return 'Carton'
  if (type === 'subst') return 'Remplacement'
  return event.detail || event.event_type
}

export function MatchCenterPanel({
  data,
  shadowBadge = false,
}: {
  data: MatchCenterData
  shadowBadge?: boolean
}) {
  const scoreReady =
    data.liveHomeScore != null && data.liveAwayScore != null
  const hasLineups = (data.lineups?.length ?? 0) > 0
  const hasEvents = (data.events?.length ?? 0) > 0
  const hasStats = (data.statistics?.length ?? 0) > 0

  return (
    <article className="panel space-y-4 p-4">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="title-display text-lg">
            {data.homeTeam} — {data.awayTeam}
          </h2>
          {shadowBadge ? (
            <span className="border border-ink bg-yellow px-2 py-0.5 text-[10px] font-black tracking-[0.12em] uppercase">
              Shadow
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          {formatKickoff(data.kickoffAt)}
          {data.roundLabel ? ` · ${data.roundLabel}` : null}
          {data.venueName ? ` · ${data.venueName}` : null}
        </p>
        <p className="text-sm font-bold text-ink">
          {providerStatusLabelFr(data.statusNormalized)}
        </p>
      </header>

      {data.phase === 'before' ? (
        <p className="text-sm font-semibold">{countdownLabel(data.kickoffAt)}</p>
      ) : null}

      {scoreReady ? (
        <p className="text-3xl font-black tracking-tight">
          {data.liveHomeScore} – {data.liveAwayScore}
          {data.liveElapsed != null ? (
            <span className="ml-2 text-base font-bold text-muted">
              {data.liveElapsed}
              {data.liveExtra != null && data.liveExtra > 0
                ? `+${data.liveExtra}`
                : ''}
              ′
            </span>
          ) : null}
        </p>
      ) : null}

      {data.phase === 'after' &&
      data.htHomeScore != null &&
      data.htAwayScore != null ? (
        <p className="text-sm text-muted">
          Mi-temps : {data.htHomeScore} – {data.htAwayScore}
        </p>
      ) : null}

      {data.stale ? (
        <p role="status" className="text-sm font-semibold text-danger">
          Données temporairement indisponibles — dernières valeurs connues.
        </p>
      ) : null}

      {data.lastSyncedAt ? (
        <p className="text-xs text-muted">
          Dernière actualisation :{' '}
          {new Date(data.lastSyncedAt).toLocaleString('fr-FR', {
            timeZone: 'Europe/Paris',
          })}
        </p>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-xs font-black tracking-[0.12em] uppercase">
          Compositions
        </h3>
        {!hasLineups ? (
          <p className="text-sm text-muted">
            Compositions non encore publiées.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.lineups!.map((lineup) => (
              <div key={lineup.teamName} className="space-y-1 text-sm">
                <p className="font-black">
                  {lineup.teamName}
                  {lineup.formation ? ` (${lineup.formation})` : ''}
                </p>
                {lineup.coachName ? (
                  <p className="text-muted">Entraîneur : {lineup.coachName}</p>
                ) : null}
                <ul className="space-y-0.5">
                  {lineup.startXI.map((player) => (
                    <li key={`${lineup.teamName}-xi-${player.name}`}>
                      {player.number != null ? `${player.number}. ` : ''}
                      {player.name}
                    </li>
                  ))}
                </ul>
                {lineup.substitutes.length > 0 ? (
                  <>
                    <p className="pt-1 text-xs font-bold uppercase text-muted">
                      Remplaçants
                    </p>
                    <ul className="space-y-0.5 text-muted">
                      {lineup.substitutes.map((player) => (
                        <li key={`${lineup.teamName}-sub-${player.name}`}>
                          {player.name}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {data.phase !== 'before' ? (
        <section className="space-y-2">
          <h3 className="text-xs font-black tracking-[0.12em] uppercase">
            Événements
          </h3>
          {!hasEvents ? (
            <p className="text-sm text-muted">Aucun événement pour l’instant.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {data.events!.map((event) => (
                <li
                  key={
                    event.external_event_key ??
                    `${event.event_type}-${event.elapsed}-${event.player_name}`
                  }
                >
                  <span className="font-bold">
                    {event.elapsed ?? '?'}
                    {event.extra ? `+${event.extra}` : ''}′
                  </span>{' '}
                  {eventLabel(event)}
                  {event.player_name ? ` — ${event.player_name}` : ''}
                  {event.assist_name ? ` (${event.assist_name})` : ''}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {hasStats ? (
        <section className="space-y-2">
          <h3 className="text-xs font-black tracking-[0.12em] uppercase">
            Statistiques
          </h3>
          <p className="text-sm text-muted">
            {Array.isArray(data.statistics)
              ? `${data.statistics.length} bloc(s) statistiques disponibles.`
              : 'Statistiques disponibles.'}
          </p>
        </section>
      ) : null}
    </article>
  )
}
