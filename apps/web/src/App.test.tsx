import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the brtlb wordmark', () => {
    render(<App />);
    expect(screen.getByText('brtlb')).toBeDefined();
  });

  it('renders the placeholder tagline', () => {
    render(<App />);
    expect(screen.getByText(/pediatric ai scribe/i)).toBeDefined();
  });
});
