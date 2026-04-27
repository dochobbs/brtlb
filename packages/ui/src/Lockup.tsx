import type { HTMLAttributes } from 'react';
import { DotsMark } from './DotsMark';
import { Wordmark } from './Wordmark';

export interface LockupProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dotColor?: string;
}

const dotPx: Record<NonNullable<LockupProps['size']>, number> = {
  sm: 28,
  md: 44,
  lg: 64,
  xl: 96,
};

export function Lockup({ size = 'lg', dotColor, className, ...rest }: LockupProps) {
  const merged = ['inline-flex flex-col items-center gap-3', className].filter(Boolean).join(' ');
  return (
    <div className={merged} {...rest}>
      <DotsMark size={dotPx[size]} color={dotColor} />
      <Wordmark size={size} />
    </div>
  );
}
