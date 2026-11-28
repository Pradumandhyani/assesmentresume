import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AudienceSelector } from '@/features/assessments/audience-selector';
import { emptyTarget, type AssignmentTarget } from '@/types/admin';

const ok = (data: unknown) => new Response(JSON.stringify({ data, meta: {} }));
function Harness() {
  const [value, setValue] = useState<AssignmentTarget>(emptyTarget);
  return (
    <>
      <AudienceSelector value={value} onChange={setValue} />
      <output data-testid="audience">{JSON.stringify(value)}</output>
    </>
  );
}
function setup() {
  const fetch = vi.fn(async (path: string) => {
    const url = new URL(path, 'http://localhost');
    if (url.pathname.endsWith('/courses'))
      return ok({
        items: [
          { name: 'CSE', studentCount: 21 },
          { name: 'MBA', studentCount: 2 },
        ],
      });
    if (url.pathname.endsWith('/institutions'))
      return ok({ items: [{ id: 'institute', institutionId: 'UNI', name: 'College' }], total: 1 });
    const page = Number(url.searchParams.get('page') ?? 1);
    return ok({
      items: [
        {
          id: `student-${page}`,
          externalId: `ID-${page}`,
          displayName: `Student ${page}`,
          course: 'CSE',
          assignments: [],
        },
      ],
      total: 21,
      page,
      pageSize: 20,
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  );
  return fetch;
}
describe('assessment audience selection', () => {
  it('retains individual selections across pages and clears them when the institution or course changes', async () => {
    const fetch = setup();
    await userEvent.click(await screen.findByLabelText(/Student 1/));
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(await screen.findByLabelText(/Student 2/));
    expect(screen.getByTestId('audience')).toHaveTextContent(
      '"studentIds":["student-1","student-2"]',
    );
    await userEvent.selectOptions(screen.getByLabelText('Institution'), 'institute');
    await waitFor(() => expect(screen.getByLabelText('Course')).toBeEnabled());
    expect(screen.getByTestId('audience')).toHaveTextContent('"studentIds":[]');
    await userEvent.selectOptions(screen.getByLabelText('Course'), 'CSE');
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([path]) => path.includes('institutionId=institute') && path.includes('course=CSE'),
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId('audience')).toHaveTextContent('"course":"CSE"');
  });
  it('selects all matching students across pages independently of the name search', async () => {
    setup();
    await screen.findByText('Student 1');
    await userEvent.click(screen.getByLabelText('Select all students on this page'));
    expect(screen.getByTestId('audience')).toHaveTextContent('"studentIds":["student-1"]');
    await userEvent.click(screen.getByLabelText('Assign all active students in this scope'));
    expect(screen.getByTestId('audience')).toHaveTextContent('"allStudents":true');
    expect(screen.getByTestId('audience')).toHaveTextContent('"studentIds":[]');
    expect(screen.getByText(/21 active students in the selected scope/)).toBeVisible();
    expect(screen.queryByLabelText('Find students')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Assign all active students in this scope'));
    expect(screen.getByTestId('audience')).toHaveTextContent('"allStudents":false');
  });
});
