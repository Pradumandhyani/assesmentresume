import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/features/auth/login-form';
import { studentApi, ApiError } from '@/services/api-client';
const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <LoginForm />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
describe('student login form', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigation.replace.mockClear();
  });
  it('validates required fields and toggles password visibility accessibly', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: /sign in to your workspace/i }));
    expect(await screen.findByText('Enter your student ID.')).toBeVisible();
    expect(screen.getByLabelText('Student ID')).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
  it.each([
    new ApiError(401, 'UNAUTHENTICATED', 'Student ID or password is incorrect.'),
    new ApiError(0, 'NETWORK_ERROR', 'Unable to connect. Check your connection and try again.'),
  ])('renders credential and network errors without navigating', async (error) => {
    vi.spyOn(studentApi, 'login').mockRejectedValue(error);
    const user = setup();
    await user.type(screen.getByLabelText('Student ID'), 'TEST-100');
    await user.type(screen.getByLabelText('Password'), 'test-password');
    await user.click(screen.getByRole('button', { name: /sign in to your workspace/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(error.message);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it('passes credentials and remember choice to the API, then navigates on success', async () => {
    const login = vi.spyOn(studentApi, 'login').mockResolvedValue({
      data: {
        user: { id: 'test-user', role: 'STUDENT', displayName: 'Test Student' },
        student: { id: 'test-student', externalId: 'TEST-100', displayName: 'Test Student' },
        expiresAt: '2026-10-18T10:00:00Z',
      },
      meta: { requestId: 'test-request', serverNow: '2026-10-11T10:00:00Z' },
    });
    const user = setup();
    await user.type(screen.getByLabelText('Student ID'), 'TEST-100');
    await user.type(screen.getByLabelText('Password'), 'test-password');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /sign in to your workspace/i }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/dashboard'));
    expect(login).toHaveBeenCalledWith(
      { identifier: 'TEST-100', password: 'test-password', remember: true },
      expect.anything(),
    );
  });
});
