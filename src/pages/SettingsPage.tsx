import { useState } from 'react'
import { LogOut, UserRound } from 'lucide-react'
import { useSession } from '../context/useSession'
import { toUserMessage } from '../lib/errors'

export function SettingsPage() {
  const {
    activePlayer,
    players,
    changePlayer,
    leaveGroup,
    refreshPlayers,
  } = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChangePlayer(playerId: string) {
    setError(null)
    setPending(true)
    try {
      await refreshPlayers()
      await changePlayer(playerId)
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <header>
        <h1 className="title-display">Paramètres</h1>
        <p className="mt-1 text-sm text-muted">
          Change de pseudo ou quitte le groupe. Aucun compte personnel.
        </p>
      </header>

      {error ? (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="active-player-title" className="panel p-4">
        <h2
          id="active-player-title"
          className="text-sm font-black tracking-[0.08em] uppercase"
        >
          Pseudo actuel
        </h2>
        <p className="mt-2 inline-flex items-center gap-2 text-base font-bold text-green-dark">
          <UserRound aria-hidden="true" className="size-5" />
          {activePlayer?.pseudo ?? '—'}
        </p>
      </section>

      <section aria-labelledby="player-list-title" className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2
            id="player-list-title"
            className="text-sm font-black tracking-[0.08em] uppercase"
          >
            Changer de joueur
          </h2>
          <p className="mt-1 text-sm text-muted">
            Mémorisé sur cet appareil uniquement.
          </p>
        </div>

        <fieldset className="divide-y divide-border" disabled={pending}>
          <legend className="sr-only">Liste des joueurs</legend>
          {players.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted">Aucun joueur actif.</p>
          ) : (
            players.map((player) => {
              const checked = player.id === activePlayer?.id
              return (
                <label
                  key={player.id}
                  className={[
                    'flex cursor-pointer items-center gap-3 px-4 py-3 transition',
                    checked ? 'bg-yellow' : 'bg-surface hover:bg-canvas',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="active-player"
                    value={player.id}
                    checked={checked}
                    onChange={() => void handleChangePlayer(player.id)}
                    className="size-4 accent-ink"
                  />
                  <span className="font-bold text-ink">{player.pseudo}</span>
                </label>
              )
            })
          )}
        </fieldset>
      </section>

      <section aria-labelledby="leave-group-title" className="panel p-4">
        <h2
          id="leave-group-title"
          className="text-sm font-black tracking-[0.08em] uppercase"
        >
          Groupe
        </h2>
        <p className="mt-1 text-sm text-muted">
          Efface le code et le pseudo mémorisés sur cet appareil.
        </p>
        <button
          type="button"
          onClick={leaveGroup}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-extrabold tracking-[0.06em] text-danger uppercase transition hover:bg-white sm:w-auto"
        >
          <LogOut aria-hidden="true" className="size-4" />
          Quitter le groupe
        </button>
      </section>
    </div>
  )
}
