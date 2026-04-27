import type { HTMLAttributes } from 'react';

export interface DotsMarkProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Width of the entire mark in pixels. Each dot is sized as a fraction of
   * this width so the proportions are stable. Default 36 — small UI use.
   */
  size?: number;
  color?: string;
}

/**
 * Three seafoam dots, perfectly aligned. Implemented with flex-aligned
 * div spans (not SVG circles) so the dots remain pixel-clean at any size
 * — the SVG version had visible sub-pixel drift at fractional sizes.
 */
export function DotsMark({ size = 36, color = '#A8E6CF', className, ...rest }: DotsMarkProps) {
  // Generous gap so the dots read as a row of three at any size.
  // dot:gap:dot:gap:dot = 25:12.5:25:12.5:25 = 100.
  const dotPx = Math.max(2, Math.round(size * 0.25));
  const gapPx = Math.max(2, Math.round(size * 0.125));

  return (
    <div
      role="img"
      aria-label="brtlb mark"
      className={['inline-flex items-center', className].filter(Boolean).join(' ')}
      style={{ gap: `${gapPx}px` }}
      {...rest}
    >
      <span
        aria-hidden
        className="block rounded-full"
        style={{ width: `${dotPx}px`, height: `${dotPx}px`, background: color }}
      />
      <span
        aria-hidden
        className="block rounded-full"
        style={{ width: `${dotPx}px`, height: `${dotPx}px`, background: color }}
      />
      <span
        aria-hidden
        className="block rounded-full"
        style={{ width: `${dotPx}px`, height: `${dotPx}px`, background: color }}
      />
    </div>
  );
}
