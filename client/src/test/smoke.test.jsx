import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

function Hello() {
  return <h1>AttendX</h1>;
}

describe('client smoke', () => {
  it('renders a basic component', () => {
    render(<Hello />);
    expect(screen.getByText('AttendX')).toBeInTheDocument();
  });
});
