import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, LogOut } from 'lucide-react'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  adminClearMatchOverride,
  adminCreateMatch,
  adminCreatePlayer,
  adminGetFixtureSyncMeta,
  adminGetMatches,
  adminGetPlayers,
  adminGetStats,
  adminSetMatchResult,
  adminSetPlayerActive,
  adminUpdateMatch,
  adminUpdatePlayerName,
  matchHasSourceDrift,
  matchSyncBadge,
  syncFcNantesMatches,
  verifyAdminCode,
  type AdminMatch,
  type AdminPlayer,
  type AdminStats,
  type FixtureSyncResult,
  TRACKED_TEAM,
} from '../lib/adminApi'
import {
  clearAdminCode,
  readAdminCode,
  saveAdminCode,
} from '../lib/adminSession'
import { localInputToUtcIso, utcIsoToLocalInput } from '../lib/datetime'
import { toUserMessage } from '../lib/errors'
import { formatKickoff, clampScore } from '../lib/format'
import { isSupabaseConfigured } from '../lib/supabase'
import type { DbMatchStatus } from '../types'

type AdminTab = 'matches' | 'players' | 'settings'

const STATUS_OPTIONS: DbMatchStatus[] = [
  'scheduled',
  'live',
  'finished',
  'postponed',
  'cancelled',
]

const DB_STATUS_LABELS: Record<DbMatchStatus, string> = {
  scheduled: 'Programmé',
  live: 'En cours',
  finished: 'Terminé',
  postponed: 'Reporté',
  cancelled: 'Annulé',
}

interface MatchFormState {
  roundNumber: string
  homeTeam: string
  awayTeam: string
  kickoffLocal: string
  status: DbMatchStatus
  homeScore: string
  awayScore: string
  externalId: string
}

const emptyMatchForm = (): MatchFormState => ({
  roundNumber: '1',
  homeTeam: TRACKED_TEAM,
  awayTeam: '',
  kickoffLocal: '',
  status: 'scheduled',
  homeScore: '',
  awayScore: '',
  externalId: '',
})

function parseOptionalScore(raw: string): number | null {
  if (raw.trim() === '') return null
  return clampScore(Number(raw))
}

export function AdminPage() {
  const [adminCode, setAdminCode] = useState<string | null>(() => readAdminCode())
  const [tab, setTab] = useState<AdminTab>('matches')

  if (!isSupabaseConfigured()) {
    return (
      <AdminShell>
        <div className="panel p-5">
          <h1 className="title-display text-xl">Configuration requise</h1>
          <p className="mt-2 text-sm text-muted">
            Variables Supabase manquantes dans le fichier `.env` local.
          </p>
        </div>
      </AdminShell>
    )
  }

  if (!adminCode) {
    return (
      <AdminShell>
        <AdminGate
          onSuccess={(code) => {
            saveAdminCode(code)
            setAdminCode(code)
          }}
        />
      </AdminShell>
    )
  }

  return (
    <AdminShell
      onLeave={() => {
        clearAdminCode()
        setAdminCode(null)
      }}
    >
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {(
          [
            ['matches', 'Matchs'],
            ['players', 'Participants'],
            ['settings', 'Réglages'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={[
              'shrink-0 border-2 px-3 py-2 text-xs font-black tracking-[0.12em] uppercase',
              tab === id
                ? 'border-ink bg-yellow text-ink'
                : 'border-border bg-surface text-muted',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'matches' ? <MatchesAdmin adminCode={adminCode} /> : null}
      {tab === 'players' ? <PlayersAdmin adminCode={adminCode} /> : null}
      {tab === 'settings' ? <SettingsAdmin adminCode={adminCode} /> : null}
    </AdminShell>
  )
}

function AdminShell({
  children,
  onLeave,
}: {
  children: ReactNode
  onLeave?: () => void
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b-2 border-ink bg-yellow px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div>
            <p className="text-lg font-black tracking-tight uppercase">
              Administration
            </p>
            <p className="text-[10px] font-bold tracking-[0.16em] text-green-dark uppercase">
              À la Nantaise · Pronos 26/27
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="border border-ink/20 px-3 py-2 text-[11px] font-bold tracking-wider uppercase"
            >
              App
            </Link>
            {onLeave ? (
              <button
                type="button"
                onClick={onLeave}
                className="inline-flex items-center gap-1 border-2 border-ink bg-ink px-3 py-2 text-[11px] font-bold tracking-wider text-yellow uppercase"
              >
                <LogOut aria-hidden="true" className="size-3.5" />
                Quitter
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-border px-4 py-3 text-center text-[10px] text-muted">
        Calendrier FC Nantes : données Fixture Download (mise à jour quotidienne
        annoncée, schéma non garanti).
      </footer>
    </div>
  )
}

function AdminGate({ onSuccess }: { onSuccess: (code: string) => void }) {
  const codeId = useId()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const ok = await verifyAdminCode(code.trim())
      if (!ok) {
        setError('Code administrateur incorrect.')
        return
      }
      onSuccess(code.trim())
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mx-auto max-w-lg panel p-5">
      <h1 className="title-display text-xl">Accès admin</h1>
      <p className="mt-1 text-sm text-muted">
        Code administrateur distinct du code joueur. Stocké uniquement pour cet
        onglet.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor={codeId}
            className="mb-2 block text-[11px] font-bold tracking-[0.12em] uppercase"
          >
            Code administrateur
          </label>
          <div className="relative">
            <KeyRound
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
            />
            <input
              id={codeId}
              type="password"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas py-3 pr-3 pl-10 font-semibold"
            />
          </div>
        </div>
        <button type="submit" className="btn-ink" disabled={pending}>
          {pending ? 'Vérification…' : 'Entrer'}
        </button>
      </form>
    </section>
  )
}

function PlayersAdmin({ adminCode }: { adminCode: string }) {
  const [players, setPlayers] = useState<AdminPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const rows = await adminGetPlayers(adminCode)
        if (!cancelled) setPlayers(rows)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [adminCode])

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      setPlayers(await adminGetPlayers(adminCode))
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setError(null)
    try {
      await adminCreatePlayer(adminCode, newName)
      setNewName('')
      setMessage('Participant ajouté.')
      await reload()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleRename(playerId: string) {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await adminUpdatePlayerName(adminCode, playerId, editName)
      setEditingId(null)
      setMessage('Pseudo mis à jour.')
      await reload()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleToggle(player: AdminPlayer) {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await adminSetPlayerActive(adminCode, player.id, !player.isActive)
      setMessage(
        player.isActive ? 'Participant désactivé.' : 'Participant réactivé.',
      )
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
        <h1 className="title-display text-xl">Participants</h1>
        <p className="mt-1 text-sm text-muted">
          Aucune suppression : désactiver conserve l’historique.
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

      <form onSubmit={handleCreate} className="panel flex flex-col gap-3 p-4 sm:flex-row">
        <label className="sr-only" htmlFor="new-player">
          Nouveau pseudo
        </label>
        <input
          id="new-player"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Nouveau pseudo"
          maxLength={30}
          required
          className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-3 py-3 font-semibold"
        />
        <button type="submit" className="btn-ink sm:w-auto" disabled={pending}>
          Ajouter
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : (
        <ul className="space-y-2">
          {players.map((player) => (
            <li key={player.id} className="panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editingId === player.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="w-full rounded-[var(--radius-sm)] border-2 border-ink px-3 py-2 font-semibold"
                        maxLength={30}
                      />
                      <button
                        type="button"
                        className="btn-ink sm:w-auto"
                        disabled={pending}
                        onClick={() => void handleRename(player.id)}
                      >
                        Sauver
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="font-black uppercase">{player.pseudo}</p>
                      <p className="mt-1 text-xs text-muted">
                        Créé le{' '}
                        {new Date(player.createdAt).toLocaleDateString('fr-FR')}
                      </p>
                    </>
                  )}
                </div>
                <span
                  className={[
                    'border px-2 py-1 text-[10px] font-black tracking-wider uppercase',
                    player.isActive
                      ? 'border-green bg-green text-white'
                      : 'border-border bg-canvas text-muted',
                  ].join(' ')}
                >
                  {player.isActive ? 'Actif' : 'Inactif'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="border-2 border-ink px-3 py-2 text-[11px] font-extrabold tracking-wider uppercase"
                  onClick={() => {
                    setEditingId(player.id)
                    setEditName(player.pseudo)
                  }}
                >
                  Modifier
                </button>
                <button
                  type="button"
                  className="border-2 border-ink px-3 py-2 text-[11px] font-extrabold tracking-wider uppercase"
                  disabled={pending}
                  onClick={() => void handleToggle(player)}
                >
                  {player.isActive ? 'Désactiver' : 'Activer'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MatchesAdmin({ adminCode }: { adminCode: string }) {
  const [matches, setMatches] = useState<AdminMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AdminMatch | null>(null)
  const [form, setForm] = useState<MatchFormState>(emptyMatchForm)
  const [pending, setPending] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [syncSummary, setSyncSummary] = useState<FixtureSyncResult | null>(null)
  const [confirmResult, setConfirmResult] = useState<null | {
    mode: 'create' | 'update' | 'result'
    payload: MatchFormState
    matchId?: string
  }>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [rows, meta] = await Promise.all([
          adminGetMatches(adminCode),
          adminGetFixtureSyncMeta(adminCode),
        ])
        if (!cancelled) {
          setMatches(rows)
          setLastSyncedAt(meta.lastSyncedAt)
        }
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [adminCode])

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [rows, meta] = await Promise.all([
        adminGetMatches(adminCode),
        adminGetFixtureSyncMeta(adminCode),
      ])
      setMatches(rows)
      setLastSyncedAt(meta.lastSyncedAt)
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyMatchForm())
    setFormOpen(true)
  }

  function openEdit(match: AdminMatch) {
    setEditing(match)
    setForm({
      roundNumber: String(match.matchday),
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffLocal: utcIsoToLocalInput(match.kickoffAt),
      status: match.dbStatus,
      homeScore:
        match.finalScore?.home != null ? String(match.finalScore.home) : '',
      awayScore:
        match.finalScore?.away != null ? String(match.finalScore.away) : '',
      externalId: match.externalId ?? '',
    })
    setFormOpen(true)
  }

  function requestSave(event: FormEvent) {
    event.preventDefault()

    if (form.status === 'finished') {
      setConfirmResult({
        mode: editing ? 'update' : 'create',
        payload: form,
        matchId: editing?.id,
      })
      return
    }

    void persistMatch(editing ? 'update' : 'create', form, editing?.id)
  }

  async function persistMatch(
    mode: 'create' | 'update' | 'result',
    payload: MatchFormState,
    matchId?: string,
  ) {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const kickoffAtUtc = localInputToUtcIso(payload.kickoffLocal)
      const homeScore = parseOptionalScore(payload.homeScore)
      const awayScore = parseOptionalScore(payload.awayScore)
      const body = {
        roundNumber: Number(payload.roundNumber),
        homeTeam: payload.homeTeam,
        awayTeam: payload.awayTeam,
        kickoffAtUtc,
        status: payload.status,
        homeScore,
        awayScore,
        externalId: payload.externalId.trim() || null,
      }

      let result
      if (mode === 'result' && matchId) {
        if (homeScore == null || awayScore == null) {
          throw new Error('INCOMPLETE_RESULT')
        }
        result = await adminSetMatchResult(
          adminCode,
          matchId,
          homeScore,
          awayScore,
        )
      } else if (mode === 'update' && matchId) {
        result = await adminUpdateMatch(adminCode, matchId, body)
      } else {
        result = await adminCreateMatch(adminCode, body)
      }

      setMessage(
        result.recalculatedCount > 0
          ? `Enregistré. ${result.recalculatedCount} pronostic(s) recalculé(s).`
          : 'Enregistré.',
      )
      setFormOpen(false)
      setEditing(null)
      setConfirmResult(null)
      await reload()
    } catch (err) {
      setError(toUserMessage(err))
      setConfirmResult(null)
    } finally {
      setPending(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setError(null)
    setMessage(null)
    setSyncSummary(null)
    try {
      const result = await syncFcNantesMatches(adminCode)
      setSyncSummary(result)
      setLastSyncedAt(result.lastSyncedAt)
      setMessage('Synchronisation terminée.')
      await reload()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setSyncing(false)
    }
  }

  async function handleClearOverride(matchId: string) {
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      const result = await adminClearMatchOverride(adminCode, matchId)
      setMessage(
        result.recalculatedCount > 0
          ? `Match remis sous synchronisation. ${result.recalculatedCount} pronostic(s) recalculé(s).`
          : 'Match remis sous synchronisation.',
      )
      await reload()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  const sorted = useMemo(
    () =>
      [...matches].sort(
        (a, b) =>
          new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime(),
      ),
    [matches],
  )

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="title-display text-xl">Matchs</h1>
          <p className="mt-1 text-sm text-muted">
            Synchronisation Fixture Download ou saisie manuelle.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ink sm:w-auto"
            disabled={syncing || pending}
            onClick={() => void handleSync()}
          >
            {syncing ? 'Synchronisation…' : 'Synchroniser les matchs'}
          </button>
          <button type="button" className="border-2 border-ink px-4 py-3 text-xs font-extrabold tracking-wider uppercase sm:w-auto" onClick={openCreate}>
            Ajouter un match
          </button>
        </div>
      </header>

      <section className="panel space-y-2 p-4 text-sm">
        <p>
          <span className="font-bold text-ink">Source</span>
          <span className="text-muted"> · </span>
          Fixture Download
        </p>
        <p className="text-muted">
          Dernière synchronisation :{' '}
          {lastSyncedAt
            ? new Date(lastSyncedAt).toLocaleString('fr-FR', {
                timeZone: 'Europe/Paris',
              })
            : 'jamais'}
        </p>
      </section>

      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite" className="text-sm font-semibold text-green-dark">
          {message}
        </p>
      ) : null}

      {syncSummary ? (
        <section className="panel space-y-1 p-4 text-sm" aria-live="polite">
          <p className="text-xs font-black tracking-[0.12em] uppercase">
            Résumé de synchronisation
          </p>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Créés : {syncSummary.created}</li>
            <li>Mis à jour : {syncSummary.updated}</li>
            <li>Inchangés : {syncSummary.unchanged}</li>
            <li>Nouveaux résultats : {syncSummary.newResults}</li>
            <li>Points recalculés : {syncSummary.pointsRecalculated}</li>
            <li>Protégés (modif. manuelle) : {syncSummary.protected}</li>
            <li>Conflits : {syncSummary.conflicts.length}</li>
          </ul>
        </section>
      ) : null}

      {formOpen ? (
        <form onSubmit={requestSave} className="panel space-y-3 p-4">
          <h2 className="text-sm font-black tracking-[0.08em] uppercase">
            {editing ? 'Modifier le match' : 'Nouveau match'}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Journée">
              <input
                type="number"
                min={1}
                max={34}
                required
                value={form.roundNumber}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    roundNumber: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
            <Field label="Coup d’envoi (heure Paris)">
              <input
                type="datetime-local"
                required
                value={form.kickoffLocal}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    kickoffLocal: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
            <Field label="Domicile">
              <input
                required
                value={form.homeTeam}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    homeTeam: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
            <Field label="Extérieur">
              <input
                required
                value={form.awayTeam}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    awayTeam: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
            <Field label="Statut">
              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as DbMatchStatus,
                  }))
                }
                className="field-input"
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Identifiant externe">
              <input
                value={form.externalId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    externalId: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
            <Field label="Score domicile">
              <input
                type="number"
                min={0}
                max={15}
                value={form.homeScore}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    homeScore: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
            <Field label="Score extérieur">
              <input
                type="number"
                min={0}
                max={15}
                value={form.awayScore}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    awayScore: event.target.value,
                  }))
                }
                className="field-input"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-ink sm:w-auto" disabled={pending}>
              Enregistrer
            </button>
            {editing ? (
              <button
                type="button"
                className="border-2 border-ink px-4 py-3 text-xs font-extrabold tracking-wider uppercase"
                disabled={pending}
                onClick={() =>
                  setConfirmResult({
                    mode: 'result',
                    payload: { ...form, status: 'finished' },
                    matchId: editing.id,
                  })
                }
              >
                Saisir / corriger le résultat
              </button>
            ) : null}
            <button
              type="button"
              className="border-2 border-border px-4 py-3 text-xs font-extrabold tracking-wider uppercase"
              onClick={() => {
                setFormOpen(false)
                setEditing(null)
              }}
            >
              Fermer
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((match) => {
            const badge = matchSyncBadge(match)
            const drift = matchHasSourceDrift(match)
            return (
              <li key={match.id} className="panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">
                      Journée {match.matchday} · {formatKickoff(match.kickoffAt)}
                    </p>
                    <p className="mt-1 font-black uppercase">
                      {match.homeTeam}
                      <span className="mx-2 text-muted">–</span>
                      {match.awayTeam}
                    </p>
                    {match.finalScore ? (
                      <p className="mt-1 text-lg font-black tabular-nums">
                        {match.finalScore.home} – {match.finalScore.away}
                      </p>
                    ) : null}
                    {drift ? (
                      <p className="mt-2 text-xs font-semibold text-danger">
                        Écart avec la source (horaire ou équipes).
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="border border-ink px-2 py-1 text-[10px] font-black tracking-wider uppercase">
                      {DB_STATUS_LABELS[match.dbStatus]}
                    </span>
                    <span
                      className={[
                        'border px-2 py-1 text-[10px] font-black tracking-wider uppercase',
                        badge === 'synced'
                          ? 'border-green bg-green text-white'
                          : badge === 'manual_override'
                            ? 'border-ink bg-yellow text-ink'
                            : 'border-border bg-canvas text-muted',
                      ].join(' ')}
                    >
                      {badge === 'synced'
                        ? 'Synchronisé'
                        : badge === 'manual_override'
                          ? 'Modifié manuellement'
                          : 'Match manuel'}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="border-2 border-ink px-3 py-2 text-[11px] font-extrabold tracking-wider uppercase"
                    onClick={() => openEdit(match)}
                  >
                    Modifier
                  </button>
                  {badge === 'manual_override' ? (
                    <button
                      type="button"
                      className="border-2 border-ink px-3 py-2 text-[11px] font-extrabold tracking-wider uppercase"
                      disabled={pending}
                      onClick={() => void handleClearOverride(match.id)}
                    >
                      Remettre sous sync
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {confirmResult ? (
        <ConfirmModal
          title="Recalcul des points"
          confirmLabel="Confirmer"
          pending={pending}
          onCancel={() => setConfirmResult(null)}
          onConfirm={() =>
            void persistMatch(
              confirmResult.mode,
              confirmResult.payload,
              confirmResult.matchId,
            )
          }
        >
          <p>
            L’enregistrement d’un résultat recalcule automatiquement tous les
            pronostics de ce match (barème 3 / 1 / 0). Une correction remplace
            les anciens points.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  )
}

function SettingsAdmin({ adminCode }: { adminCode: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const next = await adminGetStats(adminCode)
        if (!cancelled) setStats(next)
      } catch (err) {
        if (!cancelled) setError(toUserMessage(err))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [adminCode])

  return (
    <div className="space-y-4">
      <header>
        <h1 className="title-display text-xl">Réglages</h1>
        <p className="mt-1 text-sm text-muted">
          Informations utiles — aucun secret affiché.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <section className="panel divide-y divide-border">
        <StatRow
          label="Connexion Supabase"
          value={
            stats?.supabaseOk
              ? 'OK'
              : isSupabaseConfigured()
                ? 'En cours…'
                : 'Non configurée'
          }
        />
        <StatRow
          label="Participants"
          value={stats ? String(stats.playersCount) : '—'}
        />
        <StatRow
          label="Participants actifs"
          value={stats ? String(stats.activePlayersCount) : '—'}
        />
        <StatRow
          label="Matchs"
          value={stats ? String(stats.matchesCount) : '—'}
        />
        <StatRow
          label="Matchs terminés"
          value={stats ? String(stats.finishedMatchesCount) : '—'}
        />
      </section>

      <section className="panel space-y-3 p-4 text-sm text-muted">
        <p>
          <strong className="text-ink">Code commun</strong> : permet aux
          joueurs d’entrer dans l’application et de choisir un pseudo. Hashé en
          base (`access_code_hash`).
        </p>
        <p>
          <strong className="text-ink">Code administrateur</strong> : distinct,
          réservé à cet écran. Hashé en base (`admin_code_hash`). Jamais affiché
          ici.
        </p>
      </section>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block text-[11px] font-bold tracking-[0.12em] uppercase">
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm font-semibold">{label}</span>
      <span className="font-black tabular-nums">{value}</span>
    </div>
  )
}
