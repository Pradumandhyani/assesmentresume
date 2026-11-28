import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InstitutionList } from '@/features/institutions/institution-list';
import { StudentEntry } from '@/features/institutions/student-entry';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data, meta: { serverNow: '2026-11-27T00:00:00Z' } }));
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}
describe('institution and student entry forms', () => {
  it('creates an institution with the complete contact details', async () => {
    const fetch = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          ok(
            url.includes('/auth/csrf')
              ? { csrfToken: 'token' }
              : { items: [], total: 0, page: 1, pageSize: 20 },
          ),
        ),
      );
    vi.stubGlobal('fetch', fetch);
    render(<InstitutionList />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'Add institution' }));
    await userEvent.type(screen.getByLabelText('Institution ID'), 'UNI-01');
    await userEvent.type(screen.getByLabelText('Institution name'), 'University One');
    await userEvent.type(screen.getByLabelText('Main faculty / contact person'), 'Dr One');
    await userEvent.type(screen.getByLabelText('Email'), 'office@example.test');
    await userEvent.type(screen.getByLabelText('Phone'), '1234567890');
    await userEvent.click(screen.getByRole('button', { name: 'Save institution' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/admin/institutions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            institutionId: 'UNI-01',
            name: 'University One',
            mainFaculty: 'Dr One',
            email: 'office@example.test',
            phone: '1234567890',
            address: '',
          }),
          headers: expect.objectContaining({
            'X-CSRF-Token': 'token',
            'Idempotency-Key': expect.any(String),
          }),
        }),
      ),
    );
  });
  it('submits a new student to the selected institution and clears credentials after saving', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ csrfToken: 'token' }))
      .mockResolvedValueOnce(ok({ id: 'institution-1', createdCount: 1 }));
    vi.stubGlobal('fetch', fetch);
    render(<StudentEntry institutionId="institution-1" />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'Add student' }));
    await userEvent.type(screen.getByLabelText('Student ID'), 'ID-001');
    await userEvent.type(screen.getByLabelText('Student name'), 'Student One');
    await userEvent.type(screen.getByLabelText('Student email'), 'student@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'password-for-student');
    await userEvent.type(screen.getByLabelText('Course'), 'B.Tech CSE');
    await userEvent.click(screen.getByRole('button', { name: 'Save student' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Student added');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/institutions/institution-1/students',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          externalId: 'ID-001',
          displayName: 'Student One',
          email: 'student@example.test',
          password: 'password-for-student',
          cohort: '',
          course: 'B.Tech CSE',
        }),
      }),
    );
  });
  it('previews valid rows before importing and clears the file after success', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok({ csrfToken: 'token' }))
      .mockResolvedValueOnce(ok({ id: 'institution-1', createdCount: 1 }));
    vi.stubGlobal('fetch', fetch);
    render(<StudentEntry institutionId="institution-1" />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: 'Upload CSV / Excel' }));
    const file = new File([], 'students.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', {
      value: () =>
        Promise.resolve(
          'externalId,displayName,email,password,course\n001,Student One,one@example.test,password-for-student,B.Tech CSE',
        ),
    });
    await userEvent.upload(screen.getByLabelText('Student file'), file);
    expect(await screen.findByText('Student One')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 students' }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 students added');
    expect(screen.queryByText('Student One')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/institutions/institution-1/students/import',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
