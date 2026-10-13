import { devices, expect, test, type Page } from '@playwright/test';
const adminOrigin = 'http://127.0.0.1:3001';
const password = 'E2E-only-password!';
async function adminLogin(page: Page) {
  await page.goto(`${adminOrigin}/login`);
  await page.getByLabel('Administrator email').fill('browser-admin@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${adminOrigin}/dashboard`);
  await expect(page.getByRole('heading', { name: 'Assessment operations' })).toBeVisible();
}
test('administration routes reject students and invalid staff credentials', async ({
  page,
}, info) => {
  await page.goto(`${adminOrigin}/dashboard`);
  await expect(page).toHaveURL(`${adminOrigin}/login`);
  await page.getByLabel('Administrator email').fill('browser-admin@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText('incorrect');
  await page.goto('/login');
  await page.getByLabel('Student ID', { exact: true }).fill('E2E-100');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in to your workspace/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const forbidden = await page.request.get(`${adminOrigin}/api/v1/admin/dashboard`);
  expect(forbidden.status()).toBe(403);
  await page.goto(`${adminOrigin}/students`);
  await expect(page).toHaveURL(`${adminOrigin}/login`);
  await page.screenshot({ path: `artifacts/admin-login-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('admin-authored immutable question bank connects to a durable student attempt', async ({
  page,
  browser,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await adminLogin(page);
  await page.screenshot({
    path: `artifacts/admin-dashboard-${info.project.name}.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const prefix = `browser-${info.project.name}`,
    questions: { id: string; versionId: string }[] = [];
  for (let index = 0; index < 4; index++) {
    await page.goto(`${adminOrigin}/questions/create`);
    await page.getByLabel('Title', { exact: true }).fill(`${prefix} sum ${index + 1}`);
    await page.getByLabel('Unique slug').fill(`${prefix}-sum-${index + 1}`);
    await page
      .getByLabel('Difficulty', { exact: true })
      .selectOption(index < 2 ? 'EASY' : index === 2 ? 'MEDIUM' : 'HARD');
    await page.getByLabel('Maximum marks').fill(index < 2 ? '10' : index === 2 ? '20' : '30');
    await page.getByLabel('Topics', { exact: true }).fill('arrays');
    await page
      .getByLabel('Problem statement')
      .fill('Read two integers from standard input and print their sum.');
    await page.getByLabel('Input format').fill('Two integers separated by whitespace.');
    await page.getByLabel('Output format').fill('Print the sum on one line.');
    await page.getByLabel('Constraints').fill('-1000000000 <= a,b <= 1000000000');
    await page.getByLabel('Explanation').fill('Add the two input values.');
    await page.getByRole('button', { name: 'Add public case', exact: true }).click();
    await page.getByLabel('Input', { exact: true }).nth(0).fill('2 3');
    await page.getByLabel('Expected output', { exact: true }).nth(0).fill('5');
    await page.getByRole('button', { name: 'Add hidden case', exact: true }).click();
    await page.getByLabel('Input', { exact: true }).nth(1).fill('87320000 99320000');
    await page.getByLabel('Expected output', { exact: true }).nth(1).fill('186640000');
    await page.getByRole('button', { name: 'Preview student problem' }).click();
    const preview = page.getByRole('dialog');
    await expect(preview).toContainText('2 3');
    await expect(preview).not.toContainText('87320000');
    await preview.getByRole('button', { name: 'Close preview' }).click();
    await page.getByRole('button', { name: 'Save question draft', exact: true }).click();
    await expect(page).toHaveURL(/\/questions\/[0-9a-f-]+\/edit$/);
    const id = page.url().split('/').at(-2)!;
    await page.getByRole('button', { name: 'Validate saved draft', exact: true }).click();
    await expect(page.getByText('Structural validation passed')).toBeVisible();
    await expect(
      page.getByText('Runtime execution has not been validated by this check.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Publish version', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Publish version', exact: true })
      .click();
    await expect(page.getByText('PUBLISHED', { exact: true })).toBeVisible();
    const detail = (await (
      await page.request.get(`${adminOrigin}/api/v1/admin/questions/${id}`)
    ).json()) as { data: { versionId: string } };
    questions.push({ id, versionId: detail.data.versionId });
  }
  const title = `${prefix} Coding Assessment`;
  await page.goto(`${adminOrigin}/assessments/create`);
  await page.getByLabel('Assessment title').fill(title);
  await page
    .getByLabel('Description', { exact: true })
    .fill(
      'Real browser authoring and student lifecycle test. Execution is deliberately disabled on this host.',
    );
  // Pick the next whole minute far enough ahead to create/publish/assign without bypassing eligibility.
  const server = (await (
    await page.request.get(`${adminOrigin}/api/v1/admin/settings`)
  ).json()) as { data: { serverNow: string } };
  const opens = new Date(Math.ceil((Date.parse(server.data.serverNow) + 25000) / 60000) * 60000);
  const local = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  await page.getByLabel('Scheduled start', { exact: true }).fill(local(opens));
  await page.getByLabel('Latest permitted start').fill(local(new Date(opens.getTime() + 60000)));
  await page.getByLabel('Closing time').fill(local(new Date(opens.getTime() + 10920000)));
  await page.getByLabel('Results release').fill(local(new Date(opens.getTime() + 11040000)));
  await page.getByLabel('Allowed topics').fill('arrays');
  await page.getByRole('textbox', { name: 'Search question pool' }).fill(prefix);
  for (let i = 0; i < 4; i++)
    await page
      .locator('label.pool-item')
      .filter({ hasText: `${prefix} sum ${i + 1}` })
      .locator('input[type=checkbox]')
      .check();
  await page.getByRole('button', { name: 'Create draft assessment', exact: true }).click();
  await expect(page).toHaveURL(/\/assessments\/[0-9a-f-]+$/);
  const assessmentId = page.url().split('/').at(-1)!;
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Publish assessment', exact: true })
    .click();
  await expect(page.getByText('SCHEDULED', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Student assignments' }).click();
  const externalId = info.project.name === 'mobile' ? 'E2E-501' : 'E2E-500';
  await page.getByLabel('Find students').fill(externalId);
  await page
    .locator('label.pool-item')
    .filter({ hasText: externalId })
    .locator('input[type=checkbox]')
    .check();
  await page.getByRole('button', { name: /Assign students \(1\)/ }).click();
  await expect(page.getByText('Assignments persisted.')).toBeVisible();
  const studentContext = await browser.newContext({
    ...devices[info.project.name === 'mobile' ? 'iPhone 13' : 'Desktop Chrome'],
  });
  const student = await studentContext.newPage();
  const selectAll = info.project.name === 'mobile' ? 'Meta+A' : 'Control+A';
  try {
    await student.goto('http://127.0.0.1:3000/login');
    await student.getByLabel('Student ID', { exact: true }).fill(externalId);
    await student.getByLabel('Password', { exact: true }).fill(password);
    await student.getByRole('button', { name: /sign in to your workspace/i }).click();
    await expect(student).toHaveURL(/\/dashboard$/);
    const card = student.locator('.assessment-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    if (Date.now() < opens.getTime())
      await expect(
        card.getByRole('button', { name: 'Start Assessment', exact: true }),
      ).toBeDisabled();
    await expect
      .poll(
        async () => {
          const response = await student.request.get(
            `/api/v1/assessments/${assessmentId}/eligibility`,
          );
          const payload = (await response.json()) as {
            data: { eligible?: boolean; canStart?: boolean };
          };
          return payload.data.canStart ?? payload.data.eligible;
        },
        { timeout: 100000, intervals: [1000] },
      )
      .toBe(true);
    await student.getByRole('tab', { name: /active/i }).click();
    const activeCard = student.locator('.assessment-card').filter({ hasText: title });
    await expect(
      activeCard.getByRole('button', { name: 'Start Assessment', exact: true }),
    ).toBeEnabled();
    await activeCard.getByRole('button', { name: 'Start Assessment', exact: true }).click();
    await student.getByRole('dialog').getByRole('button', { name: 'Begin assessment' }).click();
    await expect(student).toHaveURL(/\/attempts\/[0-9a-f-]+$/);
    const attemptId = student.url().split('/').at(-1)!;
    const detailBefore = (await (
      await student.request.get(`/api/v1/attempts/${attemptId}`)
    ).json()) as {
      data: { questions: { id: string; questionVersionId: string }[]; expiresAt: string };
    };
    expect(detailBefore.data.questions).toHaveLength(4);
    expect(new Set(detailBefore.data.questions.map((q) => q.questionVersionId))).toEqual(
      new Set(questions.map((q) => q.versionId)),
    );
    expect(await student.locator('body').textContent()).not.toContain('87320000');
    if (info.project.name === 'mobile')
      await student.getByRole('tab', { name: 'Code', exact: true }).click();
    const editor = student.locator('.monaco-editor');
    await expect(editor).toBeVisible({ timeout: 30000 });
    await editor.click({ position: { x: 100, y: 30 } });
    await student.keyboard.press(selectAll);
    await student.keyboard.insertText('print(sum(map(int, input().split())))\n');
    await expect(student.locator('.save-indicator')).toHaveText('Saved to server');
    await student.getByLabel('Programming language').selectOption('JAVA');
    await student.getByLabel('Programming language').selectOption('PYTHON');
    await student.getByRole('button', { name: /^Question 4/ }).click();
    await student.getByRole('button', { name: /^Question 1/ }).click();
    await student.reload();
    const detailAfter = (await (
      await student.request.get(`/api/v1/attempts/${attemptId}`)
    ).json()) as typeof detailBefore;
    expect(detailAfter.data.expiresAt).toBe(detailBefore.data.expiresAt);
    expect(detailAfter.data.questions.map((q) => q.id)).toEqual(
      detailBefore.data.questions.map((q) => q.id),
    );
    if (info.project.name === 'mobile')
      await student.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(student.getByRole('button', { name: 'Run Code', exact: true })).toBeDisabled();
    await expect(
      student.getByRole('button', { name: 'Submit Solution', exact: true }),
    ).toBeDisabled();
    await student.getByRole('button', { name: 'Submit Assessment', exact: true }).click();
    await student
      .getByRole('dialog')
      .getByRole('button', { name: 'Submit final answers', exact: true })
      .click();
    await expect(student.getByText('Your final answers are locked')).toBeVisible();
    await page.goto(`${adminOrigin}/assessments/${assessmentId}`);
    await page.getByRole('tab', { name: 'Live monitoring' }).click();
    await expect(page.getByText(externalId, { exact: true })).toBeVisible();
    await expect(page.getByText('EVALUATION PENDING', { exact: true }).first()).toBeVisible();
    await page.goto(`${adminOrigin}/questions/${questions[0]!.id}/edit`);
    await page.getByRole('button', { name: 'Create new draft', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Create draft', exact: true })
      .click();
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
    const stable = (await (
      await student.request.get(`/api/v1/attempts/${attemptId}`)
    ).json()) as typeof detailBefore;
    expect(stable.data.questions.map((q) => q.questionVersionId)).toEqual(
      detailBefore.data.questions.map((q) => q.questionVersionId),
    );
    await page.goto(`${adminOrigin}/audit-logs`);
    await expect(page.getByRole('heading', { name: 'Audit trail', exact: true })).toBeVisible();
    await page.screenshot({
      path: `artifacts/admin-workflow-${info.project.name}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await studentContext.close();
  }
});
