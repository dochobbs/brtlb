import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Lockup } from './Lockup';
import { DotsMark } from './DotsMark';
import { Wordmark } from './Wordmark';

describe('brand marks', () => {
  it('Lockup renders both dots mark and wordmark', () => {
    render(<Lockup />);
    expect(screen.getByLabelText('brtlb mark')).toBeDefined();
    expect(screen.getByLabelText('brtlb')).toBeDefined();
  });

  it('Wordmark renders the lowercase brtlb text', () => {
    render(<Wordmark />);
    expect(screen.getByText('brtlb')).toBeDefined();
  });

  it('DotsMark renders three dot spans with the custom color', () => {
    const { container } = render(<DotsMark color="#000000" />);
    const dots = container.querySelectorAll('span[aria-hidden]');
    expect(dots.length).toBe(3);
    dots.forEach((dot) => {
      expect((dot as HTMLElement).style.background).toContain('rgb(0, 0, 0)');
    });
  });
});
