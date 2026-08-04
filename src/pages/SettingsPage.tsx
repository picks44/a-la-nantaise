import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { LogOut, Shield, UserRound } from 'lucide-react'
import { PwaInstallSection } from '../components/PwaInstallSection'
import { PushNotificationsSection } from '../components/PushNotificationsSection'
import { useSession } from '../context/useSession'
import { logDevError, toUserMessage } from '../lib/errors'
import { isValidPinFormat, sanitizePinInput } from '../lib/pin'

export function SettingsPage() {
  const {
    sessionToken,
    playerId,
    activePlayer,
    leaveGroup,
    logout,
    changePin,
  } = useSession()

  const oldPinId = useId()
  const newPinId = useId()
  const confirmPinId = useId()

  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleLogout() {
    setError(null)
    setPending(true)
    try {
      await logout()
    } catch (err) {
      logDevError(err)
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleChangePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    if (!isValidPinFormat(oldPin) || !isValidPinFormat(newPin)) {
      setError(toUserMessage(new Error('INVALID_PIN_FORMAT')))
      return
    }
    if (newPin !== confirmPin) {
      setError('Les deux nouveaux PIN ne correspondent pas.')
      return
    }
    setPending(true)
    try {
      await changePin(oldPin, newPin)
      setOldPin('')
      setNewPin('')
      setConfirmPin('')
      setMessage('PIN mis à jour.')
    } catch (err) {
      logDevError(err)
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="title-display">Paramètres</h1>
        <p className="mt-1 text-sm text-muted">
          Pseudo, PIN, rappels et options de cet appareil.
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

      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-labelledby="active-player-title"
          className="panel flex items-center gap-3 p-3 sm:p-4"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-green/30 bg-success-soft text-green-dark">
            <UserRound aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2
              id="active-player-title"
              className="text-[11px] font-bold tracking-[0.1em] text-muted uppercase"
            >
              Pseudo actuel
            </h2>
            <p className="truncate text-base font-semibold text-green-dark">
              {activePlayer?.pseudo ?? '—'}
            </p>
          </div>
        </section>

        <section aria-labelledby="change-pin-title" className="panel p-4 md:col-span-2">
          <h2
            id="change-pin-title"
            className="text-sm font-black tracking-[0.08em] uppercase"
          >
            Changer mon PIN
          </h2>
          <p className="mt-1 text-sm text-muted">
            4 ou 6 chiffres. Les autres appareils seront déconnectés.
          </p>
          <form onSubmit={handleChangePin} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label
                  htmlFor={oldPinId}
                  className="mb-1 block text-[11px] font-bold tracking-[0.12em] uppercase"
                >
                  PIN actuel
                </label>
                <input
                  id={oldPinId}
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={6}
                  value={oldPin}
                  onChange={(event) =>
                    setOldPin(sanitizePinInput(event.target.value))
                  }
                  required
                  className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-3 py-3 font-semibold tracking-[0.3em]"
                />
              </div>
              <div>
                <label
                  htmlFor={newPinId}
                  className="mb-1 block text-[11px] font-bold tracking-[0.12em] uppercase"
                >
                  Nouveau PIN
                </label>
                <input
                  id={newPinId}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={newPin}
                  onChange={(event) =>
                    setNewPin(sanitizePinInput(event.target.value))
                  }
                  required
                  className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-3 py-3 font-semibold tracking-[0.3em]"
                />
              </div>
              <div>
                <label
                  htmlFor={confirmPinId}
                  className="mb-1 block text-[11px] font-bold tracking-[0.12em] uppercase"
                >
                  Confirmer
                </label>
                <input
                  id={confirmPinId}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(event) =>
                    setConfirmPin(sanitizePinInput(event.target.value))
                  }
                  required
                  className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-3 py-3 font-semibold tracking-[0.3em]"
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn-ink"
              disabled={
                pending ||
                !isValidPinFormat(oldPin) ||
                !isValidPinFormat(newPin) ||
                newPin !== confirmPin
              }
            >
              {pending ? 'Enregistrement…' : 'Mettre à jour le PIN'}
            </button>
          </form>
        </section>
      </div>

      {sessionToken && playerId && activePlayer ? (
        <PushNotificationsSection
          sessionToken={sessionToken}
          playerId={playerId}
          playerPseudo={activePlayer.pseudo}
        />
      ) : null}

      <section aria-labelledby="admin-access-title" className="panel p-4">
        <h2
          id="admin-access-title"
          className="text-sm font-black tracking-[0.08em] uppercase"
        >
          Organisation
        </h2>
        <p className="mt-1 text-sm text-muted">
          Matchs, joueurs et code d’accès — réservé aux organisateurs.
        </p>
        <Link to="/admin" className="btn-secondary mt-4 gap-2">
          <Shield aria-hidden="true" className="size-4" />
          Ouvrir l’administration
        </Link>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="logout-title" className="panel p-4">
          <h2
            id="logout-title"
            className="text-sm font-black tracking-[0.08em] uppercase"
          >
            Session
          </h2>
          <p className="mt-1 text-sm text-muted">
            Déconnecte ce joueur sur cet appareil. Le code du groupe reste
            mémorisé.
          </p>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="btn-secondary mt-4 gap-2"
            disabled={pending}
          >
            <LogOut aria-hidden="true" className="size-4" />
            Se déconnecter
          </button>
        </section>

        <section aria-labelledby="leave-group-title" className="panel p-4">
          <h2
            id="leave-group-title"
            className="text-sm font-black tracking-[0.08em] uppercase"
          >
            Groupe
          </h2>
          <p className="mt-1 text-sm text-muted">
            Efface le code et la session mémorisés sur cet appareil.
          </p>
          <button
            type="button"
            onClick={() => void leaveGroup()}
            className="btn-danger mt-4"
            disabled={pending}
          >
            <LogOut aria-hidden="true" className="size-4" />
            Quitter le groupe
          </button>
        </section>
      </div>

      <PwaInstallSection />
    </div>
  )
}
