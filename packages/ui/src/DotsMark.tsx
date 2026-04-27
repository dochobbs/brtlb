import type { SVGProps } from 'react';

export interface DotsMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
  color?: string;
}

export function DotsMark({ size = 36, color = '#A8E6CF', className, ...rest }: DotsMarkProps) {
  return (
    <svg
      width={size}
      height={(size * 16) / 64}
      viewBox="0 0 64 16"
      role="img"
      aria-label="brtlb mark"
      className={className}
      {...rest}
    >
      <g fill={color}>
        <circle cx="8" cy="8" r="4" />
        <circle cx="32" cy="8" r="4" />
        <circle cx="56" cy="8" r="4" />
      </g>
    </svg>
  );
}
