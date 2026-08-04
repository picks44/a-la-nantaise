import { useCallback, useEffect, useMemo, useState } from 'react'
import { MatchCenterPanel } from './MatchCenterPanel'
import { mapProviderFixtureToMatchCenter } from '../lib/matchCenter'
import {
  adminGetProviderCompetitions,
  adminGetProviderStatus,
  adminListProviderConflicts,
  adminListProviderFixtures,
  adminResolveProviderConflict,
  adminUpdateProviderSettings,
  discoverApiFootballTeam,
  refreshApiFootballCoverage,
  syncApiFootballManual,
  type ProviderCompetition,
  type ProviderConflict,
  type ProviderFixtureAdmin,
  type ProviderStatus,
} from '../lib/adminApi'
import { toUserMessage } from '../lib/errors'
import { providerStatusLabelFr } from '../lib/providerStatus'

function formatWhen(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
}

export function ProviderAdmin({ sessionToken }: { sessionToken: string }) {
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [competitions, setCompetitions] = useState<ProviderCompetition[]>([])
  const [fixtures, setFixtures] = useState<ProviderFixtureAdmin[]>([])
  const [conflicts, setConflicts] = useState<ProviderConflict[]>([])
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null)
  const [teamSearch, setTeamSearch] = useState('Nantes')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const reload = useCallback(async () => {
    const [nextStatus, nextCompetitions, nextFixtures, nextConflicts] =
      await Promise.all([
        adminGetProviderStatus(sessionToken),
        adminGetProviderCompetitions(sessionToken),
        adminListProviderFixtures(sessionToken),
        adminListProviderConflicts(sessionToken),
      ])
    setStatus(nextStatus)
    setCompetitions(nextCompetitions)
    setFixtures(nextFixtures)
    setConflicts(nextConflicts)
    setSelectedFixtureId((current) => current ?? nextFixtures[0]?.id ?? null)
  }, [sessionToken])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await reload()
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reload])

  const selected = useMemo(
    () => fixtures.find((item) => item.id === selectedFixtureId) ?? null,
    [fixtures, selectedFixtureId],
  )

  async function runAction(
    action: () => Promise<unknown>,
    successMessage: string,
  ) {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      setMessage(successMessage)
      await reload()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="title-display text-xl">API-Football</h1>
        <p className="mt-1 text-sm text-muted">
          Mode shadow : stockage et aperçu admin uniquement. Aucune modification
          automatique des matchs officiels.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm font-semibold text-green-dark">
          {message}
        </p>
      ) : null}

      {status ? (
        <section className="panel space-y-3 p-4 text-sm">
          <p className="text-xs font-black tracking-[0.12em] uppercase">
            État fournisseur
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-muted">Intégration</dt>
              <dd className="font-bold">
                {status.integrationEnabled ? 'Activée' : 'Désactivée'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Mode shadow</dt>
              <dd className="font-bold">
                {status.shadowEnabled ? 'Oui' : 'Non'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted">Activation publique</dt>
              <dd className="font-bold">
                {status.publicActivationMessage}
              </dd>
              <p className="mt-1 text-xs text-muted">
                Flag figé (`public_provider_enabled = false`). Aucun contrôle
                disponible ici — réservé à `feature/api-football-cutover`.
              </p>
            </div>
            <div>
              <dt className="text-muted">Équipe suivie</dt>
              <dd className="font-bold">
                {status.trackedTeamName ?? 'Non configurée'}
                {status.trackedTeamExternalId != null
                  ? ` (#${status.trackedTeamExternalId})`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Saison externe</dt>
              <dd className="font-bold">
                {status.activeSeasonYear ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Quota du jour (UTC)</dt>
              <dd className="font-bold">
                {status.consumedCount} consommés · {status.remainingUsable}{' '}
                utilisables · réserve {status.quotaReserve}/
                {status.dailyQuotaLimit}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Dernier succès</dt>
              <dd className="font-bold">
                {formatWhen(status.lastSuccessfulCallAt)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Dernière erreur</dt>
              <dd className="font-bold">
                {status.lastErrorCode
                  ? `${status.lastErrorCode} · ${formatWhen(status.lastErrorAt)}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Prochain appel prévu</dt>
              <dd className="font-bold">
                {formatWhen(status.nextScheduledCallAt)}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              className="btn-ink sm:w-auto"
              disabled={pending}
              onClick={() =>
                void runAction(
                  () => syncApiFootballManual(sessionToken),
                  'Calendrier synchronisé en shadow.',
                )
              }
            >
              Synchroniser (shadow)
            </button>
            <button
              type="button"
              className="border-2 border-ink px-4 py-3 text-xs font-extrabold tracking-wider uppercase sm:w-auto"
              disabled={pending}
              onClick={() =>
                void runAction(
                  () => refreshApiFootballCoverage(sessionToken),
                  'Couverture actualisée.',
                )
              }
            >
              Vérifier la couverture
            </button>
            <button
              type="button"
              className="border-2 border-ink px-4 py-3 text-xs font-extrabold tracking-wider uppercase sm:w-auto"
              disabled={pending}
              onClick={() =>
                void runAction(
                  () =>
                    adminUpdateProviderSettings(sessionToken, {
                      integrationEnabled: !status.integrationEnabled,
                    }),
                  status.integrationEnabled
                    ? 'Intégration désactivée.'
                    : 'Intégration activée.',
                )
              }
            >
              {status.integrationEnabled
                ? 'Désactiver l’intégration'
                : 'Activer l’intégration'}
            </button>
          </div>

          <form
            className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
            onSubmit={(event) => {
              event.preventDefault()
              void runAction(
                () => discoverApiFootballTeam(sessionToken, teamSearch),
                'Équipe et compétitions découvertes.',
              )
            }}
          >
            <label className="grow text-xs font-bold tracking-wide uppercase">
              Découvrir l’équipe
              <input
                className="field-input mt-1"
                value={teamSearch}
                onChange={(event) => setTeamSearch(event.target.value)}
                placeholder="Nantes"
              />
            </label>
            <button
              type="submit"
              className="border-2 border-ink px-4 py-3 text-xs font-extrabold tracking-wider uppercase"
              disabled={pending || teamSearch.trim().length < 2}
            >
              Vérifier via API
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel space-y-2 p-4">
        <h2 className="text-xs font-black tracking-[0.12em] uppercase">
          Compétitions suivies
        </h2>
        {competitions.length === 0 ? (
          <p className="text-sm text-muted">
            Aucune compétition. Lance une découverte d’équipe.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {competitions.map((competition) => (
              <li key={competition.id} className="border-b border-border pb-2">
                <p className="font-bold">
                  {competition.name} · {competition.externalSeasonYear}
                  {!competition.enabled ? ' (désactivée)' : ''}
                </p>
                <p className="text-muted">
                  League #{competition.externalLeagueId}
                  {competition.country ? ` · ${competition.country}` : ''}
                  {competition.competitionType
                    ? ` · ${competition.competitionType}`
                    : ''}
                </p>
                <p className="text-xs text-muted">
                  Couverture : events{' '}
                  {competition.coverageEvents == null
                    ? '?'
                    : competition.coverageEvents
                      ? 'oui'
                      : 'non'}
                  · lineups{' '}
                  {competition.coverageLineups == null
                    ? '?'
                    : competition.coverageLineups
                      ? 'oui'
                      : 'non'}
                  · stats équipes{' '}
                  {competition.coverageStatisticsFixtures == null
                    ? '?'
                    : competition.coverageStatisticsFixtures
                      ? 'oui'
                      : 'non'}
                  · stats joueurs{' '}
                  {competition.coverageStatisticsPlayers == null
                    ? '?'
                    : competition.coverageStatisticsPlayers
                      ? 'oui'
                      : 'non'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {conflicts.length > 0 ? (
        <section className="panel space-y-2 p-4">
          <h2 className="text-xs font-black tracking-[0.12em] uppercase">
            Conflits de rapprochement
          </h2>
          <ul className="space-y-3 text-sm">
            {conflicts.map((conflict) => (
              <li key={conflict.id} className="space-y-2 border-b border-border pb-2">
                <p className="font-bold">
                  Fixture {conflict.externalFixtureId} · {conflict.reason}
                </p>
                <p className="text-muted">
                  Candidats : {conflict.candidateMatchIds.join(', ') || 'aucun'}
                </p>
                {conflict.candidateMatchIds[0] ? (
                  <button
                    type="button"
                    className="border-2 border-ink px-3 py-2 text-xs font-extrabold uppercase"
                    disabled={pending}
                    onClick={() =>
                      void runAction(
                        () =>
                          adminResolveProviderConflict(
                            sessionToken,
                            conflict.id,
                            conflict.candidateMatchIds[0]!,
                          ),
                        'Conflit résolu.',
                      )
                    }
                  >
                    Lier au premier candidat
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel space-y-3 p-4">
        <h2 className="text-xs font-black tracking-[0.12em] uppercase">
          Aperçu centre du match (admin)
        </h2>
        {fixtures.length === 0 ? (
          <p className="text-sm text-muted">
            Aucun snapshot fournisseur pour l’instant.
          </p>
        ) : (
          <>
            <label className="block text-xs font-bold uppercase">
              Fixture
              <select
                className="field-input mt-1"
                value={selectedFixtureId ?? ''}
                onChange={(event) => setSelectedFixtureId(event.target.value)}
              >
                {fixtures.map((fixture) => (
                  <option key={fixture.id} value={fixture.id}>
                    {fixture.homeTeam} – {fixture.awayTeam} ·{' '}
                    {providerStatusLabelFr(fixture.providerStatusNormalized)}
                  </option>
                ))}
              </select>
            </label>
            {selected ? (
              <MatchCenterPanel
                shadowBadge
                data={mapProviderFixtureToMatchCenter({
                  homeTeam: selected.homeTeam,
                  awayTeam: selected.awayTeam,
                  kickoffAt: selected.kickoffAt,
                  venueName: selected.venueName,
                  roundLabel: selected.roundLabel,
                  statusNormalized: selected.providerStatusNormalized,
                  liveHomeScore: selected.liveHomeScore,
                  liveAwayScore: selected.liveAwayScore,
                  lastSyncedAt: selected.lastSyncedAt,
                  lineupsJson: selected.lineupsJson,
                  eventsJson: selected.eventsJson,
                  statisticsJson: selected.statisticsJson,
                })}
              />
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
