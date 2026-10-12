import { expect, test } from '@playwright/test';
test('unauthorized students are redirected to sign in', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});
test('student signs in, sees persisted assessment, refreshes safely and signs out', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('Student ID', { exact: true }).fill('E2E-100');
  await page.getByLabel('Password', { exact: true }).fill('E2E-only-password!');
  await page.getByRole('button', { name: /sign in to your workspace/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: /welcome back, avery/i })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'DSA Coding Assessment — Round 1' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Assessment' })).toBeDisabled();
  await expect(page.getByRole('timer')).toBeVisible();
  const before = await page.getByRole('timer').getAttribute('aria-label');
  await page.evaluate(() => {
    Date.now = () => 9999999999999;
  });
  await page.waitForTimeout(1100);
  await expect(page.getByRole('button', { name: 'Start Assessment' })).toBeDisabled();
  expect(await page.getByRole('timer').getAttribute('aria-label')).not.toBe(before);
  await page.screenshot({ path: `artifacts/dashboard-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'DSA Coding Assessment — Round 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Avery Test/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
test('incorrect credentials give feedback and the login layout fits the viewport', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('Student ID', { exact: true }).fill('E2E-100');
  await page.getByLabel('Password', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: /sign in to your workspace/i }).click();
  await expect(page.locator('form [role="alert"]')).toContainText(
    'Student ID or password is incorrect.',
  );
  await expect(page).toHaveURL(/\/login$/);
  await page.screenshot({ path: `artifacts/login-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
