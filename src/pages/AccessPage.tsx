import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, LockKeyhole, UserRound } from 'lucide-react'
import { useSession } from '../context/useSession'
import { toUserMessage } from '../lib/errors'

export function AccessPage() {
  const {
    phase,
    players,
    pendingPlayerId,
    bootstrapError,
    submitAccessCode,
    selectPlayerForLogin,
    loginWithPin,
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

  async function handleSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await submitAccessCode(code)
      setCode('')
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleSubmitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      await loginWithPin(pin)
      setPin('')
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setPending(false)
    }
  }

  async function handleChangePin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
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
    } catch (err) {
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
            'Ajoute VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY dans un fichier .env local.'}
        </p>
      </AccessShell>
    )
  }

  if (phase === 'needs_pin_change') {
    return (
      <AccessShell>
        <h1 className="title-display text-xl">Nouveau PIN requis</h1>
        <p className="mt-1 text-sm text-muted">
          Pour sécuriser ton accès, choisis un PIN personnel à 4 ou 6 chiffres.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleChangePin} className="mt-5 space-y-4">
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
              value={oldPin}
              onChange={(event) => setOldPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas px-3 py-3 font-semibold tracking-[0.3em]"
              placeholder="••••"
            />
          </div>
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
              value={newPin}
              onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
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
              Confirmer le PIN
            </label>
            <input
              id={confirmPinId}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirmPin}
              onChange={(event) =>
                setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))
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
              (newPin.length !== 4 && newPin.length !== 6) ||
              newPin !== confirmPin
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
          {pendingPlayer
            ? `Entre le PIN de ${pendingPlayer.pseudo}.`
            : 'Entre ton PIN personnel.'}
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
              PIN
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
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
                }
                required
                className="w-full rounded-[var(--radius-sm)] border-2 border-ink bg-canvas py-3 pr-3 pl-10 font-semibold tracking-[0.3em] text-ink transition focus:bg-surface"
                placeholder="••••"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={pending || (pin.length !== 4 && pin.length !== 6)}
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
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center bg-ink text-[11px] font-black tracking-tight text-yellow"
          >
            ALN
          </span>
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
