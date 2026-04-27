import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the brtlb wordmark via the Lockup', () => {
    render(<App />);
    expect(screen.getByLabelText('brtlb')).toBeDefined();
  });

  it('renders the dots mark', () => {
    render(<App />);
    expect(screen.getByLabelText('brtlb mark')).toBeDefined();
  });

  it('renders the primary brand tagline', () => {
    render(<App />);
    expect(screen.getByText('Less noise. Same meaning.')).toBeDefined();
  });

  it('renders the category descriptor', () => {
    render(<App />);
    expect(screen.getByText('Pediatric documentation, compressed.')).toBeDefined();
  });
});
