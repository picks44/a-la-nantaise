import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, LoaderCircle } from 'lucide-react'
import {
  deactivatePushSubscription,
  registerPushSubscription,
} from '../lib/api'
import { toUserMessage } from '../lib/errors'
import {
  getExistingPushSubscription,
  resolvePushActivationState,
  resolvePushGateState,
  serializationFromSubscription,
  subscribeToPush,
  unsubscribeLocalPush,
  type PushUiState,
} from '../lib/push'
import { isBrowserOnline } from '../lib/pwa'

interface PushNotificationsSectionProps {
  sessionToken: string
  playerId: string
  playerPseudo: string
}

export function PushNotificationsSection({
  sessionToken,
  playerId,
  playerPseudo,
}: PushNotificationsSectionProps) {
  const [uiState, setUiState] = useState<PushUiState>(() => resolvePushGateState())
  const [message, setMessage] = useState<string | null>(null)
  const [messageNonce, setMessageNonce] = useState(0)
  const [messageKind, setMessageKind] = useState<'success' | 'error' | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const gate = resolvePushGateState()
    if (
      gate === 'unsupported' ||
      gate === 'insecure_context' ||
      gate === 'misconfigured' ||
      gate === 'ios_install_required' ||
      gate === 'service_worker_unavailable' ||
      gate === 'denied'
    ) {
      setUiState(gate)
      return
    }

    try {
      const activation = await resolvePushActivationState(
        sessionToken,
        playerId,
      )
      if (activation === 'hidden') {
        setUiState(gate)
        return
      }
      if (activation === 'active') {
        setUiState('active')
        return
      }

      setUiState(
        Notification.permission === 'granted' ? 'granted_inactive' : 'default',
      )
    } catch {
      setUiState(gate === 'granted_inactive' ? 'granted_inactive' : 'default')
    }
  }, [sessionToken, playerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleEnable() {
    setMessage(null)
    setMessageKind(null)
    if (!isBrowserOnline()) {
      setMessageKind('error')
      setMessage('Connexion indisponible. Réessaie une fois reconnecté.')
      return
    }

    setBusy(true)
    setUiState('pending')
    try {
      const subscription = await subscribeToPush()
      const serialized = serializationFromSubscription(subscription)
      await registerPushSubscription({
        sessionToken,
        endpoint: serialized.endpoint,
        p256dh: serialized.p256dh,
        auth: serialized.auth,
        expirationTime: serialized.expirationTime,
        userAgent: navigator.userAgent,
      })
      setUiState('active')
      setMessageKind('success')
      setMessageNonce((n) => n + 1)
      setMessage(`Rappels activés pour ${playerPseudo}.`)
    } catch (error) {
      setMessageKind('error')
      if (Notification.permission === 'denied') {
        setUiState('denied')
      } else {
        setUiState(resolvePushGateState())
      }
      setMessage(toUserMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    setMessage(null)
    setMessageKind(null)
    setBusy(true)
    try {
      const subscription = await getExistingPushSubscription()
      if (subscription) {
        await deactivatePushSubscription(sessionToken, subscription.endpoint)
        await unsubscribeLocalPush()
      }
      setUiState(
        Notification.permission === 'granted' ? 'granted_inactive' : 'default',
      )
      setMessageKind('success')
      setMessageNonce((n) => n + 1)
      setMessage('Rappels désactivés sur cet appareil.')
    } catch (error) {
      setMessageKind('error')
      setMessage(toUserMessage(error))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="push-reminders-title" className="panel p-4">
      <h2
        id="push-reminders-title"
        className="text-sm font-black tracking-[0.08em] uppercase"
      >
        Rappels de pronostic
      </h2>
      <p className="mt-1 text-sm text-muted">
        Reçois des rappels avant les matchs, juste avant le coup d’envoi et
        lorsque les résultats sont disponibles.
      </p>

      {uiState === 'ios_install_required' ? (
        <p className="mt-4 text-sm text-ink">
          Sur iPhone ou iPad, installe d’abord l’application sur l’écran
          d’accueil (menu Partager), puis rouvre-la depuis l’icône pour activer
          les rappels.
        </p>
      ) : null}

      {uiState === 'insecure_context' ? (
        <p className="mt-4 text-sm text-muted">
          Les rappels nécessitent une connexion sécurisée (HTTPS). Ouvre le site
          en HTTPS ou teste via <code>npm run build</code> puis{' '}
          <code>npm run preview</code>.
        </p>
      ) : null}

      {uiState === 'misconfigured' ? (
        <p className="mt-4 text-sm text-muted">
          Les rappels ne sont pas encore configurés sur ce déploiement (clé
          VAPID publique manquante).
        </p>
      ) : null}

      {uiState === 'unsupported' ? (
        <p className="mt-4 text-sm text-muted">
          Les notifications push ne sont pas disponibles sur ce navigateur.
        </p>
      ) : null}

      {uiState === 'service_worker_unavailable' ? (
        <p className="mt-4 text-sm text-muted">
          Les notifications push ne sont pas disponibles avec{' '}
          <code>npm run dev</code> (service worker désactivé). Arrête Vite,
          lance <code>npm run build</code> puis <code>npm run preview</code>, et
          ouvre l’URL indiquée (souvent <code>http://localhost:4173</code>).
        </p>
      ) : null}

      {uiState === 'denied' ? (
        <p className="mt-4 text-sm text-ink">
          Les notifications sont bloquées pour ce site. Réactive-les dans les
          réglages du navigateur ou du système, puis reviens ici.
        </p>
      ) : null}

      {uiState === 'active' ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-green-dark">
            Rappels activés pour {playerPseudo}
          </p>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void handleDisable()}
          >
            <BellOff aria-hidden="true" className="size-4 shrink-0" />
            Désactiver les rappels
          </button>
        </div>
      ) : null}

      {uiState === 'default' ||
      uiState === 'granted_inactive' ||
      uiState === 'pending' ? (
        <button
          type="button"
          className="btn-ink mt-4"
          disabled={busy || uiState === 'pending'}
          onClick={() => void handleEnable()}
        >
          {busy || uiState === 'pending' ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin"
            />
          ) : (
            <Bell aria-hidden="true" className="size-4 shrink-0" />
          )}
          {uiState === 'granted_inactive'
            ? 'Réactiver les rappels'
            : 'Activer les rappels'}
        </button>
      ) : null}

      {message ? (
        <p
          key={messageNonce}
          role="status"
          aria-live="polite"
          className={
            messageKind === 'success'
              ? 'ui-message-pop mt-3 text-sm text-muted'
              : 'mt-3 text-sm text-muted'
          }
        >
          {message}
        </p>
      ) : null}
    </section>
  )
}
