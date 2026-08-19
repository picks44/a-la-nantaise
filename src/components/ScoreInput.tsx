import { useId } from 'react'
import { SCORE_MAX, SCORE_MIN, clampScore } from '../lib/format'

interface ScoreInputProps {
  id?: string
  label: string
  value: number | null
  onChange: (value: number | null) => void
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
        'min-w-0',
        isBoard
          ? // subgrid : la case du score partage la même ligne que le séparateur du parent
            'row-span-2 grid grid-rows-subgrid items-end justify-items-center self-stretch'
          : 'flex flex-1 flex-col items-center gap-2',
      ].join(' ')}
    >
      <label
        htmlFor={inputId}
        className={[
          'max-w-full text-center leading-snug text-balance',
          isBoard
            ? 'text-xs font-bold text-ink sm:text-sm'
            : 'label-caps',
        ].join(' ')}
      >
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        value={value ?? ''}
        disabled={disabled}
        required
        aria-label={`Score prédit pour ${label}`}
        aria-valuemin={SCORE_MIN}
        aria-valuemax={SCORE_MAX}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/\D/g, '')
          onChange(digits === '' ? null : Number(digits))
        }}
        onBlur={(event) => {
          if (event.currentTarget.value !== '') {
            onChange(clampScore(Number(event.currentTarget.value)))
          }
        }}
        className={[
          'text-center font-black tabular-nums transition-[color,background-color,border-color,box-shadow] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50',
          isBoard
            ? 'mx-auto w-full max-w-[5.5rem] rounded-[var(--radius-sm)] border-2 border-green-dark bg-green-dark py-2 text-[1.75rem] text-yellow shadow-sm ring-offset-2 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ink sm:max-w-[6.5rem] sm:py-3 sm:text-4xl'
            : 'w-full max-w-[5.5rem] rounded-[var(--radius-sm)] border border-border bg-surface text-3xl text-ink',
        ].join(' ')}
      />
    </div>
  )
}
