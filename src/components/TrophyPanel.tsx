import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarCheck,
  Crown,
  Eye,
  Flame,
  Medal,
  Shield,
  Sparkles,
  Target,
  Trophy,
  type LucideIcon,
} from 'lucide-react'
import { ConfettiBurst } from './ConfettiBurst'
import {
  celebrationStorageKey,
  getCelebrationNumber,
  getCelebrationFlag,
  setCelebrationNumber,
  setCelebrationFlag,
} from '../lib/celebrations'
import {
  formatLockedTrophyProgress,
  formatTrophyAwardMeta,
  hasLockedTrophyProgress,
} from '../lib/trophyDisplay'
import type { TrophyAward, TrophyOverview } from '../types'


function StatusCard({
  message,
  tone = 'neutral',
}: {
  message: string
  tone?: 'neutral' | 'error'
}) {
  return (
    <div
      className={[
        'panel p-4 text-sm',
        tone === 'error' ? 'font-semibold text-danger' : 'text-muted',
      ].join(' ')}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {message}
    </div>
  )
}

const SIGNIFICANT_CONFETTI_TROPHY_KEYS = new Set<string>([
  'first_participation',
  'first_exact_score',
] )

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function TrophyPanel({
  overview,
  loading,
  error,
  acknowledging,
  groupId,
  playerId,
  onDismissCelebration,
}: {
  overview: TrophyOverview | null
  loading: boolean
  error: string | null
  acknowledging: boolean
  groupId: string
  playerId: string
  onDismissCelebration: () => void
}) {
  const stats = overview?.stats ?? {
    currentPredictionStreak: 0,
    bestPredictionStreak: 0,
    currentGoodResultStreak: 0,
    bestGoodResultStreak: 0,
    currentExactStreak: 0,
    bestExactStreak: 0,
    totalExactScores: 0,
    trophiesCount: 0,
  }
  const pending = overview?.pendingCelebrations ?? []
  const seasonId = overview?.seasonId ?? ''

  const isColdStart =
    stats.trophiesCount === 0 &&
    stats.totalExactScores === 0 &&
    stats.currentPredictionStreak === 0 &&
    stats.bestPredictionStreak === 0

  const pendingIdsSignature = pending.map((p) => p.id).slice().sort().join('|')
  const confettiIdsSignature = pending
    .filter((p) => SIGNIFICANT_CONFETTI_TROPHY_KEYS.has(p.trophyKey))
    .map((p) => p.id)
    .slice()
    .sort()
    .join('|')

  const [panelAnimatedSignature, setPanelAnimatedSignature] = useState<string | null>(
    null,
  )
  const [confettiActive, setConfettiActive] = useState(false)

  const lastPanelSignatureRef = useRef<string | null>(null)
  const lastConfettiSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!groupId || !playerId || !seasonId) return

    if (
      pendingIdsSignature &&
      lastPanelSignatureRef.current !== pendingIdsSignature
    ) {
      lastPanelSignatureRef.current = pendingIdsSignature
      const panelKey = celebrationStorageKey({
        groupId,
        playerId,
        seasonId,
        eventType: 'trophy_pending_panel',
        eventId: pendingIdsSignature,
      })

      const shouldAnimatePanel = !getCelebrationFlag(panelKey)
      if (shouldAnimatePanel) {
        setPanelAnimatedSignature(pendingIdsSignature)
        setCelebrationFlag(panelKey)
      } else {
        setPanelAnimatedSignature(null)
      }
    }

    const reduced = prefersReducedMotion()
    if (
      !confettiActive &&
      confettiIdsSignature &&
      lastConfettiSignatureRef.current !== confettiIdsSignature
    ) {
      lastConfettiSignatureRef.current = confettiIdsSignature
      const confettiKey = celebrationStorageKey({
        groupId,
        playerId,
        seasonId,
        eventType: 'trophy_confetti',
        eventId: confettiIdsSignature,
      })

      if (!getCelebrationFlag(confettiKey)) {
        setCelebrationFlag(confettiKey)
        // Even when animations are neutralized (prefers-reduced-motion),
        // we still consider the celebration as "seen" to prevent a later replay.
        if (!reduced) {
          setConfettiActive(true)
        }
      }
    }
  }, [
    groupId,
    playerId,
    seasonId,
    pendingIdsSignature,
    confettiIdsSignature,
    confettiActive,
  ])

  const championPendingIdsSignature = pending
    .filter((p) => p.trophyKey === 'champion_de_la_journee')
    .map((p) => p.id)
    .slice()
    .sort()
    .join('|')

  const [championAnimatedSignature, setChampionAnimatedSignature] = useState<
    string | null
  >(null)
  const lastChampionSignatureRef = useRef<string | null>(null)

  useEffect(() => {
    if (!groupId || !playerId || !seasonId) return
    if (!championPendingIdsSignature) return

    if (lastChampionSignatureRef.current === championPendingIdsSignature)
      return
    lastChampionSignatureRef.current = championPendingIdsSignature

    const key = celebrationStorageKey({
      groupId,
      playerId,
      seasonId,
      eventType: 'trophy_champion_day_highlight',
      eventId: championPendingIdsSignature,
    })

    const shouldAnimate = !getCelebrationFlag(key)
    if (shouldAnimate) {
      setChampionAnimatedSignature(championPendingIdsSignature)
      setCelebrationFlag(key)
    } else {
      setChampionAnimatedSignature(null)
    }
  }, [groupId, playerId, seasonId, championPendingIdsSignature])

  const recordValueKey = useMemo(() => {
    return groupId && playerId && seasonId
      ? celebrationStorageKey({
          groupId,
          playerId,
          seasonId,
          eventType: 'record_personal_best_prediction_streak',
          eventId: 'bestPredictionStreak',
        })
      : ''
  }, [groupId, playerId, seasonId])

  const recordBaselineRef = useRef<number | null>(null)
  const recordPulseTimerRef = useRef<number | null>(null)

  const [recordPulseNonce, setRecordPulseNonce] = useState(0)
  const [recordPulseActive, setRecordPulseActive] = useState(false)

  useEffect(() => {
    if (!groupId || !playerId || !seasonId) return
    if (!recordValueKey) return

    const current = stats.bestPredictionStreak

    if (recordBaselineRef.current == null) {
      const stored = getCelebrationNumber(recordValueKey)
      if (stored == null) {
        setCelebrationNumber(recordValueKey, current)
        recordBaselineRef.current = current
        return
      }
      recordBaselineRef.current = stored
    }

    const baseline = recordBaselineRef.current
    if (current > baseline) {
      recordBaselineRef.current = current
      setCelebrationNumber(recordValueKey, current)

      setRecordPulseNonce((n) => n + 1)
      setRecordPulseActive(true)

      if (recordPulseTimerRef.current != null) {
        globalThis.clearTimeout(recordPulseTimerRef.current)
      }
      recordPulseTimerRef.current = globalThis.setTimeout(
        () => setRecordPulseActive(false),
        420,
      )
    }
  }, [groupId, playerId, seasonId, recordValueKey, stats.bestPredictionStreak])

  useEffect(() => {
    return () => {
      if (recordPulseTimerRef.current != null) {
        globalThis.clearTimeout(recordPulseTimerRef.current)
        recordPulseTimerRef.current = null
      }
    }
  }, [])

  if (loading) {
    return <StatusCard message="Chargement des trophées…" />
  }

  if (error) {
    return <StatusCard message={error} tone="error" />
  }

  if (!overview) {
    return (
      <StatusCard
        message="Statistiques temporairement indisponibles."
        tone="error"
      />
    )
  }

  return (
    <div className="page-stack">
      {pending.length > 0 ? (
        <section
          className={[
            'relative overflow-hidden rounded-[var(--radius-md)] border border-ink bg-yellow',
            panelAnimatedSignature === pendingIdsSignature
              ? 'ui-trophy-panel-reveal'
              : '',
          ].join(' ')}
          aria-live="polite"
        >
          {confettiActive ? (
            <ConfettiBurst
              reducedMotion={prefersReducedMotion()}
              onDone={() => setConfettiActive(false)}
            />
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="flex items-start gap-3">
              <span className="flex size-11 items-center justify-center rounded-[var(--radius-sm)] border border-ink bg-green-dark text-yellow">
                <Trophy className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-black tracking-[0.08em] uppercase text-ink">
                  Nouveau trophée
                </p>
                <p className="mt-1 text-sm text-ink/80">
                  {pending.length > 1
                    ? `${pending.length} nouveaux trophées ont été débloqués.`
                    : `${pending[0]?.name ?? 'Un trophée'} a été débloqué.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-ink min-h-11 sm:w-auto"
              onClick={onDismissCelebration}
              disabled={acknowledging}
            >
              {acknowledging ? 'Validation…' : 'Fermer'}
            </button>
          </div>
          <ul className="divide-y divide-ink/15 border-t border-ink/20">
            {pending.map((item, index) => {
              const panelShouldAnimate = panelAnimatedSignature === pendingIdsSignature
              const stagger = panelShouldAnimate && index < 3
              const championHighlight =
                !stagger &&
                championAnimatedSignature === championPendingIdsSignature &&
                item.trophyKey === 'champion_de_la_journee'
              return (
                <li
                  key={item.id}
                  className={[
                    'flex items-start gap-3 px-4 py-3',
                    stagger ? 'ui-trophy-item-reveal' : '',
                    championHighlight ? 'ui-champion-trophy-highlight' : '',
                  ].join(' ')}
                  style={stagger ? { animationDelay: `${index * 120}ms` } : undefined}
                >
                <TrophyIcon name={item.icon} unlocked />
                <div>
                  <p className="font-bold text-ink">{item.name}</p>
                  <p className="mt-0.5 text-sm text-ink/75">{item.description}</p>
                </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[var(--radius-md)] border border-green-dark bg-green-dark text-yellow">
        <div className="grid gap-0 sm:grid-cols-3">
          <HeroStat
            icon={Flame}
            label="Série actuelle"
            value={String(stats.currentPredictionStreak)}
            hint="participations d’affilée"
          />
          <div
            key={recordPulseNonce}
            className={recordPulseActive ? 'ui-record-highlight' : undefined}
          >
            <HeroStat
              icon={Crown}
              label="Record"
              value={String(stats.bestPredictionStreak)}
              hint="meilleure série"
              bordered
            />
          </div>
          <HeroStat
            icon={Trophy}
            label="Trophées obtenus"
            value={String(stats.trophiesCount)}
            hint={
              stats.totalExactScores > 0
                ? `${stats.totalExactScores} score${stats.totalExactScores > 1 ? 's' : ''} exact${stats.totalExactScores > 1 ? 's' : ''}`
                : 'cette saison'
            }
            bordered
          />
        </div>
      </section>

      {isColdStart ? (
        <section className="panel border-dashed px-3 py-2.5 sm:px-4">
          <div className="flex items-start gap-3 sm:items-center">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-ink bg-yellow text-ink">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-black text-ink">La chasse commence ici</p>
              <p className="mt-0.5 text-sm text-muted">
                Pronostique ton prochain match pour débloquer « Première
                participation » et lancer tes séries.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {overview.earnedTrophies.length > 0 ? (
        <section className="space-y-2">
          <h3 className="label-caps">Débloqués</h3>
          <ul className="space-y-1.5">
            {overview.earnedTrophies.map((item) => (
              <li key={item.id}>
                <EarnedTrophyCard trophy={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview.lockedTrophies.length > 0 ? (
        <section className="space-y-2">
          <h3 className="label-caps">Encore à débloquer</h3>
          <ul className="space-y-1.5">
            {overview.lockedTrophies.map((item) => (
              <li key={item.trophyKey}>
                <LockedTrophyCard trophy={item} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function HeroStat({
  icon: Icon,
  label,
  value,
  hint,
  bordered = false,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
  bordered?: boolean
}) {
  return (
    <div
      className={[
        'px-3 py-2.5 sm:px-4 sm:py-3',
        bordered ? 'border-t border-yellow/25 sm:border-t-0 sm:border-l' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-1.5 text-yellow/80">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <p className="text-[11px] font-bold tracking-[0.08em] uppercase leading-snug">
          {label}
        </p>
      </div>
      <p className="mt-1 text-2xl font-black tabular-nums text-yellow sm:text-3xl">
        {value}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-yellow/65">{hint}</p>
    </div>
  )
}

function EarnedTrophyCard({ trophy }: { trophy: TrophyAward }) {
  const meta = formatTrophyAwardMeta({
    awardedAt: trophy.awardedAt,
    sourceRoundNumber: trophy.sourceRoundNumber,
    sourceMatchLabel: trophy.sourceMatchLabel,
  })

  return (
    <article className="panel overflow-hidden border-green-dark/40 bg-yellow/15">
      <div className="flex items-start gap-3 px-3 py-2 sm:px-4 sm:py-2.5">
        <TrophyIcon name={trophy.icon} unlocked />
        <div className="min-w-0 flex-1">
          <p className="font-black text-ink">{trophy.name}</p>
          <p className="mt-0.5 text-sm text-muted">{trophy.description}</p>
          {meta ? (
            <p className="mt-1 text-xs text-muted">{meta}</p>
          ) : null}
        </div>
      </div>
    </article>
  )
}

function LockedTrophyCard({
  trophy,
}: {
  trophy: TrophyOverview['lockedTrophies'][number]
}) {
  const hasProgress = hasLockedTrophyProgress(trophy)
  const ratio = hasProgress
    ? Math.min(1, trophy.progressCurrent! / trophy.progressTarget!)
    : 0
  const nearComplete = hasProgress && ratio >= 0.5

  return (
    <article
      className={[
        'panel overflow-hidden',
        nearComplete ? 'border-yellow bg-yellow/10' : 'opacity-90',
      ].join(' ')}
      aria-label={`${trophy.name}, verrouillé`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2 sm:px-3.5 sm:py-2">
        <TrophyIcon name={trophy.icon} unlocked={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 font-semibold text-ink">{trophy.name}</p>
            {hasProgress ? (
              <span className="shrink-0 text-xs font-bold tabular-nums text-ink">
                {formatLockedTrophyProgress(
                  trophy.progressCurrent!,
                  trophy.progressTarget!,
                )}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted">{trophy.description}</p>
          {hasProgress ? (
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full border border-ink/40 bg-ink/10"
              role="progressbar"
              aria-valuenow={trophy.progressCurrent!}
              aria-valuemin={0}
              aria-valuemax={trophy.progressTarget!}
              aria-label={`Progression ${trophy.name}`}
            >
              <div
                className="h-full bg-yellow transition-[width]"
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

const TROPHY_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  target: Target,
  medal: Medal,
  eye: Eye,
  'calendar-check': CalendarCheck,
  crown: Crown,
  trophy: Trophy,
  shield: Shield,
}

function TrophyIcon({
  name,
  unlocked,
}: {
  name: string
  unlocked: boolean
}) {
  const Icon = TROPHY_ICONS[name] ?? Trophy
  return (
    <span
      className={[
        'flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] border',
        unlocked
          ? 'size-12 border-ink bg-yellow text-ink'
          : 'size-9 border-ink/25 bg-surface-muted text-ink/55',
      ].join(' ')}
      aria-hidden
    >
      <Icon className={unlocked ? 'size-5' : 'size-4'} />
    </span>
  )
}

