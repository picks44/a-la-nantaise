import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, LockKeyhole, UserRound } from 'lucide-react'
import { BrandMark } from '../components/BrandMark'
import { useSession } from '../context/useSession'
import { logDevError, toUserMessage } from '../lib/errors'
import { isValidPinFormat, sanitizePinInput } from '../lib/pin'

export function AccessPage() {
  const {
    phase,
    players,
    pendingPlayerId,
    activePlayer,
    canCompleteForcedPinChange,
    bootstrapError,
    submitAccessCode,
    selectPlayerForLogin,
    loginWithPin,
    completeForcedPinChange,
    changePin,
  } = useSession()

  const codeId = useId()
  const pinId = useId()
  const oldPinId = useId()
  const newPinId = useId()
  const confirmPinId = useId()

  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const pendingPlayer =
    players.find((player) => player.id === pendingPlayerId) ?? null
  const pinOwnerPseudo =
    pendingPlayer?.pseudo ?? activePlayer?.pseudo ?? 'ce joueur'

  async function handleSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await submitAccessCode(code)
      setCode('')
    } catch (err) {
      logDevError(err)
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleSubmitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!isValidPinFormat(pin)) {
      setError(toUserMessage(new Error('INVALID_PIN_FORMAT')))
      return
    }
    setPending(true)
    try {
      await loginWithPin(pin)
      setPin('')
    } catch (err) {
      logDevError(err)
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleForcedPinChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!isValidPinFormat(newPin)) {
      setError(toUserMessage(new Error('INVALID_PIN_FORMAT')))
      return
    }
    if (newPin !== confirmPin) {
      setError('Les deux nouveaux PIN ne correspondent pas.')
      return
    }
    if (!canCompleteForcedPinChange && !isValidPinFormat(oldPin)) {
      setError(toUserMessage(new Error('INVALID_PIN_FORMAT')))
      return
    }
    setPending(true)
    try {
      if (canCompleteForcedPinChange) {
        await completeForcedPinChange(newPin)
      } else {
        await changePin(oldPin, newPin)
      }
      setOldPin('')
      setNewPin('')
      setConfirmPin('')
    } catch (err) {
      logDevError(err)
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  if (phase === 'misconfigured') {
    return (
      <AccessShell>
        <h1 className="title-display text-xl">Configuration requise</h1>
        <p className="mt-2 text-sm text-muted">
          {bootstrapError ??
            'Ajoute VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans `.env.local` ou `.env`.'}
        </p>
      </AccessShell>
    )
  }

  if (phase === 'needs_pin_change') {
    return (
      <AccessShell>
        <h1 className="title-display text-xl">Choisis ton nouveau PIN</h1>
        <p className="mt-1 text-sm text-muted">
          Ton PIN temporaire doit être remplacé par un PIN personnel à 4 ou 6
          chiffres.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleForcedPinChange} className="mt-5 space-y-4">
          {!canCompleteForcedPinChange ? (
            <div>
              <label
                htmlFor={oldPinId}
                className="mb-2 block text-[11px] font-bold tracking-[0.12em] uppercase"
              >
                PIN temporaire
              </label>
              <input
                id={oldPinId}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={oldPin}
                onChange={(event) =>
                  setOldPin(sanitizePinInput(event.target.value))
                }
                required
                className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-3 py-3 font-semibold tracking-[0.3em]"
                placeholder="••••••"
              />
            </div>
          ) : null}
          <div>
            <label
              htmlFor={newPinId}
              className="mb-2 block text-[11px] font-bold tracking-[0.12em] uppercase"
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
              placeholder="••••"
            />
          </div>
          <div>
            <label
              htmlFor={confirmPinId}
              className="mb-2 block text-[11px] font-bold tracking-[0.12em] uppercase"
            >
              Confirmer le nouveau PIN
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
              placeholder="••••"
            />
          </div>
          <button
            type="submit"
            disabled={
              pending ||
              !isValidPinFormat(newPin) ||
              newPin !== confirmPin ||
              (!canCompleteForcedPinChange && !isValidPinFormat(oldPin))
            }
            className="btn-ink"
          >
            {pending ? 'Enregistrement…' : 'Enregistrer mon PIN'}
          </button>
        </form>
      </AccessShell>
    )
  }

  if (phase === 'needs_pin') {
    return (
      <AccessShell>
        <h1 className="title-display text-xl">Ton PIN</h1>
        <p className="mt-1 text-sm text-muted">
          Entre le PIN à 4 ou 6 chiffres de {pinOwnerPseudo}.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleSubmitPin} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor={pinId}
              className="mb-2 block text-[11px] font-bold tracking-[0.12em] uppercase"
            >
              PIN à 4 ou 6 chiffres
            </label>
            <div className="relative">
              <LockKeyhole
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
              />
              <input
                id={pinId}
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(sanitizePinInput(event.target.value))}
                required
                className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas py-3 pr-3 pl-10 font-semibold tracking-[0.3em] text-ink transition focus:bg-surface"
                placeholder="••••••"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={pending || !isValidPinFormat(pin)}
            className="btn-ink"
          >
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </AccessShell>
    )
  }

  if (phase === 'needs_player') {
    return (
      <AccessShell>
        <h1 className="title-display text-xl">Qui joue ?</h1>
        <p className="mt-1 text-sm text-muted">
          Choisis ton pseudo, puis saisis ton PIN.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}

        {players.length === 0 ? (
          <div className="mt-5 border border-dashed border-border bg-canvas p-4 text-sm text-muted">
            Aucun joueur actif pour le moment.
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-border border border-border">
            {players.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null)
                    selectPlayerForLogin(player.id)
                  }}
                  className="flex w-full items-center gap-3 bg-surface px-3 py-3.5 text-left font-bold text-ink transition hover:bg-yellow disabled:opacity-60"
                >
                  <UserRound aria-hidden="true" className="size-5 text-green" />
                  {player.pseudo}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AccessShell>
    )
  }

  return (
    <AccessShell>
      <h1 className="title-display text-xl">Entrée du groupe</h1>
      <p className="mt-1 text-sm text-muted">
        Code commun du groupe, puis ton PIN personnel.
      </p>

      {(error || bootstrapError) && (
        <p role="alert" className="mt-4 text-sm font-semibold text-danger">
          {error ?? bootstrapError}
        </p>
      )}

      <form onSubmit={handleSubmitCode} className="mt-5 space-y-4">
        <div>
          <label
            htmlFor={codeId}
            className="mb-2 block text-[11px] font-bold tracking-[0.12em] uppercase"
          >
            Code du groupe
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
              className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas py-3 pr-3 pl-10 font-semibold text-ink transition focus:bg-surface"
              placeholder="Code commun"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || code.trim().length === 0}
          className="btn-ink"
        >
          {pending ? 'Vérification…' : 'Continuer'}
        </button>
      </form>
    </AccessShell>
  )
}

function AccessShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="border-b-2 border-ink bg-yellow px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <BrandMark size="md" className="rounded-[var(--radius-sm)]" />
          <div>
            <p className="text-xl font-black tracking-tight text-ink uppercase">
              À la Nantaise
            </p>
            <p className="text-[10px] font-bold tracking-[0.16em] text-green-dark uppercase">
              Pronos 26/27
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6 sm:px-6">
        <section className="panel p-5">{children}</section>
      </main>
    </div>
  )
}
