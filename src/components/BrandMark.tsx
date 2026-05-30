import logoUrl from '../assets/brand/papyrus-logo.png'

type BrandMarkProps = {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClass: Record<NonNullable<BrandMarkProps['size']>, string> = {
  sm: 'size-8 rounded-lg',
  md: 'size-10 rounded-xl',
  lg: 'size-12 rounded-2xl',
}

export function BrandMark({ size = 'md', className = '' }: BrandMarkProps) {
  return (
    <img
      src={logoUrl}
      alt="Papyrus"
      className={`${sizeClass[size]} shrink-0 object-cover shadow-[0_10px_28px_rgba(23,23,20,0.18)] ${className}`}
      draggable={false}
    />
  )
}
