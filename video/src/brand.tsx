import type { CSSProperties } from 'react'

export const FONT = "'SF Pro', -apple-system, 'Helvetica Neue', sans-serif"

export const C = {
  ink: '#17161c',
  dim: 'rgba(23, 22, 28, 0.58)',
  bg: '#f7f4ef',
  accent: '#e4572e',
  shadow: 'rgba(60, 40, 20, 0.26)'
}

/** The Lyrique icon ("Now and next"), same artwork as build/icon.svg, with the macOS corner shape. */
export function Logo({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" style={{ display: 'block', ...style }}>
      <defs>
        <linearGradient id="lq-bg" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#ff7a3d" />
          <stop offset="0.5" stopColor="#e5466b" />
          <stop offset="1" stopColor="#3b5bdb" />
        </linearGradient>
        <clipPath id="lq-mask">
          <rect width="1024" height="1024" rx="230" />
        </clipPath>
      </defs>
      <g clipPath="url(#lq-mask)">
        <rect width="1024" height="1024" fill="url(#lq-bg)" />
        <rect x="192" y="364" width="640" height="128" rx="64" fill="#fff" fillOpacity="0.32" />
        <rect x="192" y="364" width="430" height="128" rx="64" fill="#fff" />
        <rect x="192" y="556" width="460" height="104" rx="52" fill="#fff" fillOpacity="0.32" />
      </g>
    </svg>
  )
}
