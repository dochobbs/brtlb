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

  it('DotsMark accepts a custom color prop', () => {
    const { container } = render(<DotsMark color="#000000" />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(3);
    circles.forEach((c) => {
      expect(c.parentElement?.getAttribute('fill')).toBe('#000000');
    });
  });
});
