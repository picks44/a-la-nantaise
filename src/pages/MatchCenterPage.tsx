import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../context/useSession'
import { getSupabase } from '../lib/supabase'
import { toUserMessage } from '../lib/errors'

/**
 * Route publique du centre du match.
 * Masquée tant que `public_provider_enabled` est false (branche shadow).
 */
export function MatchCenterPage() {
  const { sessionToken } = useSession()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionToken) {
      setEnabled(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data, error: rpcError } = await getSupabase().rpc(
          'get_public_match_center_enabled',
          { p_session_token: sessionToken },
        )
        if (rpcError) throw rpcError
        if (!cancelled) setEnabled(Boolean(data))
      } catch (err) {
        if (!cancelled) {
          setEnabled(false)
          setError(toUserMessage(err))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionToken])

  if (enabled === null) {
    return (
      <div className="panel p-5">
        <p className="text-sm text-muted">Chargement…</p>
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="panel space-y-3 p-5">
        <h1 className="title-display text-xl">Centre du match</h1>
        <p className="text-sm text-muted">
          Le centre du match n’est pas encore disponible publiquement. Les
          données fournisseur restent en mode shadow (administration uniquement).
        </p>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        ) : null}
        <Link to="/" className="btn-ink inline-flex w-auto">
          Retour à l’accueil
        </Link>
      </div>
    )
  }

  // Cutover ultérieur : brancher ici le rendu public.
  return (
    <div className="panel space-y-3 p-5">
      <h1 className="title-display text-xl">Centre du match</h1>
      <p className="text-sm text-muted">
        Activation publique détectée. Le rendu détaillé sera branché lors du
        cutover.
      </p>
    </div>
  )
}
