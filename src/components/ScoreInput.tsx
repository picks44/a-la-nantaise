import { useId } from 'react'
import { SCORE_MAX, SCORE_MIN, clampScore } from '../lib/format'

interface ScoreInputProps {
  id?: string
  label: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
  /** Variante tableau d’affichage (accueil). */
  variant?: 'default' | 'board'
}

export function ScoreInput({
  id,
  label,
  value,
  onChange,
  disabled = false,
  variant = 'default',
}: ScoreInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const isBoard = variant === 'board'

  return (
    <div
      className={[
        'flex min-w-0 flex-1 flex-col',
        isBoard ? 'items-center gap-1.5' : 'items-center gap-2',
      ].join(' ')}
    >
      <label
        htmlFor={inputId}
        className={[
          'max-w-full text-center font-black tracking-tight uppercase',
          isBoard
            ? 'text-xs leading-tight text-ink sm:text-sm'
            : 'label-caps',
        ].join(' ')}
      >
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={SCORE_MIN}
        max={SCORE_MAX}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={`Score prédit pour ${label}`}
        onChange={(event) => {
          const next = Number(event.target.value)
          onChange(clampScore(next))
        }}
        className={[
          'text-center font-black tabular-nums transition disabled:cursor-not-allowed disabled:opacity-50',
          isBoard
            ? 'mx-auto w-full max-w-[5.5rem] rounded-[var(--radius-sm)] border border-ink bg-ink py-2.5 text-3xl text-yellow sm:max-w-[6.5rem] sm:py-3 sm:text-4xl'
            : 'w-full max-w-[5.5rem] rounded-[var(--radius-sm)] border border-border bg-surface text-3xl text-ink',
        ].join(' ')}
      />
    </div>
  )
}
