import type { HTMLAttributes } from 'react';

export interface WordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClass: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-2xl',
  lg: 'text-4xl',
  xl: 'text-6xl',
};

export function Wordmark({ size = 'lg', className, ...rest }: WordmarkProps) {
  const base = 'font-semibold lowercase select-none';
  const merged = [base, sizeClass[size], className].filter(Boolean).join(' ');
  return (
    <span
      role="img"
      aria-label="brtlb"
      className={merged}
      style={{ letterSpacing: '-0.035em' }}
      {...rest}
    >
      brtlb
    </span>
  );
}
