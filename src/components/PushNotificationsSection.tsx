import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, LoaderCircle } from 'lucide-react'
import {
  deactivatePushSubscription,
  getPushSubscriptionStatus,
  registerPushSubscription,
} from '../lib/api'
import { toUserMessage } from '../lib/errors'
import {
  getExistingPushSubscription,
  resolvePushGateState,
  serializationFromSubscription,
  subscribeToPush,
  unsubscribeLocalPush,
  type PushUiState,
} from '../lib/push'
import { isBrowserOnline } from '../lib/pwa'

interface PushNotificationsSectionProps {
  accessCode: string
  playerId: string
  playerPseudo: string
}

export function PushNotificationsSection({
  accessCode,
  playerId,
  playerPseudo,
}: PushNotificationsSectionProps) {
  const [uiState, setUiState] = useState<PushUiState>(() => resolvePushGateState())
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const gate = resolvePushGateState()
    if (
      gate === 'unsupported' ||
      gate === 'ios_install_required' ||
      gate === 'denied'
    ) {
      setUiState(gate)
      return
    }

    try {
      const subscription = await getExistingPushSubscription()
      if (!subscription) {
        setUiState(
          Notification.permission === 'granted' ? 'granted_inactive' : 'default',
        )
        return
      }

      const status = await getPushSubscriptionStatus(
        accessCode,
        subscription.endpoint,
      )
      if (status?.active && status.playerId === playerId) {
        setUiState('active')
        return
      }

      setUiState('granted_inactive')
    } catch {
      setUiState(gate === 'granted_inactive' ? 'granted_inactive' : 'default')
    }
  }, [accessCode, playerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function handleEnable() {
    setMessage(null)
    if (!isBrowserOnline()) {
      setMessage('Connexion indisponible. Réessaie une fois reconnecté.')
      return
    }

    setBusy(true)
    setUiState('pending')
    try {
      const subscription = await subscribeToPush()
      const serialized = serializationFromSubscription(subscription)
      await registerPushSubscription({
        accessCode,
        playerId,
        endpoint: serialized.endpoint,
        p256dh: serialized.p256dh,
        auth: serialized.auth,
        expirationTime: serialized.expirationTime,
        userAgent: navigator.userAgent,
      })
      setUiState('active')
      setMessage(`Rappels activés pour ${playerPseudo}.`)
    } catch (error) {
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
    setBusy(true)
    try {
      const subscription = await getExistingPushSubscription()
      if (subscription) {
        await deactivatePushSubscription(accessCode, subscription.endpoint)
        await unsubscribeLocalPush()
      }
      setUiState(
        Notification.permission === 'granted' ? 'granted_inactive' : 'default',
      )
      setMessage('Rappels désactivés sur cet appareil.')
    } catch (error) {
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
        Reçois un rappel environ 24 h puis 2 h avant un match si tu n’as pas
        encore enregistré ton prono.
      </p>

      {uiState === 'ios_install_required' ? (
        <p className="mt-4 text-sm text-ink">
          Sur iPhone ou iPad, installe d’abord l’application sur l’écran
          d’accueil (menu Partager), puis rouvre-la depuis l’icône pour activer
          les rappels.
        </p>
      ) : null}

      {uiState === 'unsupported' ? (
        <p className="mt-4 text-sm text-muted">
          Les notifications push ne sont pas disponibles sur ce navigateur.
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
            className="btn-ghost"
            disabled={busy}
            onClick={() => void handleDisable()}
          >
            <BellOff aria-hidden="true" className="size-4" />
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
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Bell aria-hidden="true" className="size-4" />
          )}
          {uiState === 'granted_inactive'
            ? 'Réactiver les rappels'
            : 'Activer les rappels'}
        </button>
      ) : null}

      {message ? (
        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted">
          {message}
        </p>
      ) : null}
    </section>
  )
}
