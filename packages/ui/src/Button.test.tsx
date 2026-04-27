import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('fires onClick', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(<Button onClick={() => clicks++}>Tap</Button>);
    await user.click(screen.getByRole('button', { name: 'Tap' }));
    expect(clicks).toBe(1);
  });

  it('respects disabled', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <Button disabled onClick={() => clicks++}>
        No
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(clicks).toBe(0);
  });
});
