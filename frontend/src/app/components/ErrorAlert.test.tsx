import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ErrorAlert from './ErrorAlert';

describe('ErrorAlert', () => {
  it('renders nothing without a message and shows provided text otherwise', () => {
    const { container, rerender } = render(<ErrorAlert message="" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ErrorAlert message="Something failed" />);
    expect(screen.getByText('Something failed')).toBeInTheDocument();
  });
});

