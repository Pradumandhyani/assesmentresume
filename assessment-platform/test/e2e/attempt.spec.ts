import { expect, test } from '@playwright/test';
test('coding workspace persists language drafts, recovers refresh and finalizes real snapshots', async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  // Monaco maps an emulated iPhone to macOS keyboard bindings even on a Windows host.
  const selectAll = info.project.name === 'mobile' ? 'Meta+A' : 'Control+A';
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page
    .getByLabel('Student ID', { exact: true })
    .fill(info.project.name === 'mobile' ? 'E2E-201' : 'E2E-200');
  await page.getByLabel('Password', { exact: true }).fill('E2E-only-password!');
  await page.getByRole('button', { name: /sign in to your workspace/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('tab', { name: /active/i }).click();
  await page.getByRole('button', { name: 'Start Assessment', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Begin assessment' }).click();
  await expect(page).toHaveURL(/\/attempts\/[0-9a-f-]+$/);
  const url = page.url(),
    attemptId = url.split('/').at(-1)!;
  await expect(page.getByRole('button', { name: 'Question 1', exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toBeVisible();
  if (info.project.name === 'mobile')
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible({ timeout: 30000 });
  await editor.click({ position: { x: 100, y: 30 } });
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText('print(42)\n');
  await expect(page.locator('.save-indicator')).toHaveText('Saved to server');
  await page.getByLabel('Programming language').selectOption('JAVA');
  await expect(page.getByLabel('Programming language')).toHaveValue('JAVA');
  await editor.click({ position: { x: 100, y: 30 } });
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText('class Main { public static void main(String[] args) {} }\n');
  await expect(page.locator('.save-indicator')).toHaveText('Saved to server');
  await page.getByLabel('Programming language').selectOption('PYTHON');
  await expect(page.getByLabel('Programming language')).toHaveValue('PYTHON');
  await page.getByRole('button', { name: /^Question 4/ }).click();
  await expect(page.locator('.question-tab.selected')).toHaveText('Q4');
  await page.getByRole('button', { name: /^Question 1/ }).click();
  await expect(page.locator('.question-tab.selected')).toHaveText('Q1');
  await expect(page.locator('.save-indicator')).toHaveText('Saved to server');
  await page.reload();
  await expect(page).toHaveURL(url);
  if (info.project.name === 'mobile')
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(page.locator('.save-indicator')).toHaveText('Saved to server');
  const before = (await (
    await page.request.get(`/api/v1/attempts/${attemptId}/drafts`)
  ).json()) as { data: { items: { language: string; sourceCode: string }[] } };
  expect(before.data.items.find((d) => d.language === 'PYTHON')?.sourceCode).toBe('print(42)\n');
  expect(before.data.items.find((d) => d.language === 'JAVA')?.sourceCode).toContain('class Main');
  await context.setOffline(true);
  await editor.click({ position: { x: 100, y: 30 } });
  await page.keyboard.press(selectAll);
  await page.keyboard.insertText('print(99)\n');
  await expect(page.locator('.save-indicator')).toHaveText(/Not saved|Save failed/);
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await expect(page.locator('.save-indicator')).toHaveText('Saved to server');
  if (info.project.name === 'mobile')
    await page.getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(page.getByText('Execution is not available yet')).toBeVisible();
  if (info.project.name === 'mobile')
    await page.getByRole('tab', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run Code', exact: true })).toBeDisabled();
  await page.screenshot({ path: `artifacts/attempt-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Submit Assessment', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Submit Assessment', exact: true }).click();
  let releaseFinalization!: () => void;
  const heldRequest = new Promise<void>((resolve) => {
    releaseFinalization = resolve;
  });
  let requestPaused = false;
  // Delay transport only: the real API still persists and returns the final snapshots.
  await page.route(`**/api/v1/attempts/${attemptId}/finalize`, async (route) => {
    requestPaused = true;
    await heldRequest;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Submit final answers', exact: true }).click();
    await expect.poll(() => requestPaused).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saving & submitting…' })).toBeDisabled();
  } finally {
    releaseFinalization();
  }
  await expect(page.getByText('Your final answers are locked')).toBeVisible();
  await expect(page.getByLabel('Programming language')).toBeDisabled();
  const history = (await (
    await page.request.get(`/api/v1/attempts/${attemptId}/history`)
  ).json()) as { data: { items: { sourceCode: string; purpose: string; status: string }[] } };
  expect(history.data.items).toHaveLength(4);
  expect(history.data.items.some((s) => s.sourceCode === 'print(99)\n')).toBe(true);
  expect(history.data.items.every((s) => s.purpose === 'FINAL' && s.status === 'PENDING')).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
