const SIZE_CLASS = {
  sm: 'size-9',
  md: 'size-11',
  lg: 'size-16',
  xl: 'size-20',
} as const

const SIZE_PX = {
  sm: 36,
  md: 44,
  lg: 64,
  xl: 80,
} as const

type BrandMarkProps = {
  size?: keyof typeof SIZE_CLASS
  /** When true, the mark is decorative (empty alt / aria-hidden). */
  decorative?: boolean
  className?: string
}

/** Heraldic ALN crest — source: public/brand/aln-logo-512.png */
export function BrandMark({
  size = 'sm',
  decorative = true,
  className = '',
}: BrandMarkProps) {
  const px = SIZE_PX[size]
  return (
    <img
      src="/brand/aln-logo-512.png"
      alt={decorative ? '' : 'À la Nantaise'}
      aria-hidden={decorative || undefined}
      width={px}
      height={px}
      decoding="async"
      className={`shrink-0 object-contain ${SIZE_CLASS[size]} ${className}`.trim()}
    />
  )
}
