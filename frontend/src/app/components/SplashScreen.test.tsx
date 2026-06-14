import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SplashScreen from './SplashScreen';

const loginMock = vi.fn();
const setSystemCredentialsMock = vi.fn();
const enableLightModeMock = vi.fn();

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    login: loginMock,
    setSystemCredentials: setSystemCredentialsMock,
    enableLightMode: enableLightModeMock,
  }),
}));

vi.mock('./DesktopWindowTitleBar', () => ({
  default: () => null,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('SplashScreen credential flow', () => {
  beforeEach(() => {
    loginMock.mockReset();
    setSystemCredentialsMock.mockReset();
    enableLightModeMock.mockReset();
  });

  it('clears processing state after saving credentials and starting login', async () => {
    const user = userEvent.setup();
    setSystemCredentialsMock.mockResolvedValue(true);
    loginMock.mockResolvedValue(undefined);

    render(<SplashScreen status="unauthenticated_needs_keys" progress="" />);

    await user.type(screen.getByPlaceholderText('Client ID'), 'client-id');
    await user.type(screen.getByPlaceholderText('Client Secret'), 'client-secret');
    await user.click(screen.getByRole('button', { name: /save & login with battle\.net/i }));

    await waitFor(() => {
      expect(setSystemCredentialsMock).toHaveBeenCalledWith('client-id', 'client-secret');
      expect(loginMock).toHaveBeenCalledWith('client-id', 'client-secret');
    });
    await waitFor(() => {
      expect(screen.queryByText('Processing...')).not.toBeInTheDocument();
    });
  });
});
