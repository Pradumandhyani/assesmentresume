import { expect, test } from '@playwright/test';
import { studentWorkbook } from '../support/student-workbook';
test.use({ timezoneId: 'UTC' });

test('creates an institution and adds single, CSV and Excel students', async ({ page }, info) => {
  const origin = 'http://127.0.0.1:3001',
    prefix = `admissions-${info.project.name}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/login`);
  await page.getByLabel('Administrator email').fill('browser-admin@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('E2E-only-password!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/dashboard`);
  await page.goto(`${origin}/institutions`);
  await page.getByRole('button', { name: 'Add institution' }).click();
  await page.getByLabel('Institution ID', { exact: true }).fill(prefix);
  await page.getByLabel('Institution name').fill(`${prefix} college`);
  await page.getByLabel('Main faculty / contact person').fill('Dr Faculty');
  await page.getByLabel('Email', { exact: true }).fill(`${prefix}@example.test`);
  await page.getByLabel('Phone').fill('1234567890');
  await page.getByLabel('Address (optional)').fill('College Road');
  await page.getByRole('button', { name: 'Save institution' }).click();
  await expect(page).toHaveURL(/\/institutions\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Add student', exact: true }).click();
  await page.getByLabel('Student ID', { exact: true }).fill(`${prefix}-single`);
  await page.getByLabel('Student name').fill('Single Student');
  await page.getByLabel('Student email').fill(`${prefix}-single@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Single-password-123!');
  await page.getByLabel('Course', { exact: true }).fill('B.Tech CSE');
  await page.getByRole('button', { name: 'Save student' }).click();
  await expect(page.getByRole('status')).toContainText('Student added');
  await expect(page.getByRole('cell', { name: `${prefix}-single`, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Upload CSV / Excel' }).click();
  await page.getByLabel('Student file').setInputFiles({
    name: 'students.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `externalId,displayName,email,password,cohort,course\r\n${prefix}-csv,CSV Student,${prefix}-csv@example.test,Csv-password-123!,2026,B.Tech CSE\r\n`,
    ),
  });
  await expect(page.getByRole('button', { name: 'Import 1 students' })).toBeEnabled();
  await page.getByRole('button', { name: 'Import 1 students' }).click();
  await expect(page.getByRole('status')).toContainText('1 students added');
  await expect(page.getByRole('cell', { name: `${prefix}-csv`, exact: true })).toBeVisible();

  await page.getByLabel('Student file').setInputFiles({
    name: 'students.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: studentWorkbook(`${prefix}-xlsx`),
  });
  await expect(page.getByRole('button', { name: 'Import 1 students' })).toBeEnabled();
  await page.getByRole('button', { name: 'Import 1 students' }).click();
  await expect(page.getByRole('status')).toContainText('1 students added');
  await expect(page.getByRole('cell', { name: `${prefix}-xlsx`, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Institution ID: .* · 3 students/)).toBeVisible();
  for (const source of ['single', 'csv', 'xlsx'])
    await expect(
      page.getByRole('cell', { name: `${prefix}-${source}`, exact: true }),
    ).toBeVisible();
  // The institution shortcut carries the scope into assessment creation.
  await page.getByRole('link', { name: 'Create assessment for this institution' }).click();
  await expect(page.getByLabel('Assign students when creating this assessment')).toBeChecked();
  await expect(page.getByLabel('Institution', { exact: true })).not.toHaveValue('');
  await page.getByLabel('Course', { exact: true }).selectOption('B.Tech CSE');
  await page.getByLabel('Assign all active students in this scope').check();
  await expect(page.getByText(/3 active students in the selected scope/)).toBeVisible();
  await page.screenshot({
    path: `artifacts/assessment-audience-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByLabel('Assessment title').fill(`${prefix} course assessment`);
  const starts = Math.ceil((Date.now() + 300000) / 60000) * 60000;
  // These tests use UTC browser time, matching the ISO input values.
  const local = (offset: number) => new Date(starts + offset).toISOString().slice(0, 16);
  await page.getByLabel('Scheduled start', { exact: true }).fill(local(0));
  await page.getByLabel('Latest permitted start').fill(local(60000));
  await page.getByLabel('Closing time').fill(local(1200000));
  await page.getByLabel('Duration (minutes)').fill('15');
  await page.getByLabel('easy questions').fill('1');
  await page.getByLabel('medium questions').fill('0');
  await page.getByLabel('hard questions').fill('0');
  await page.getByRole('button', { name: 'Create draft assessment', exact: true }).click();
  await expect(page).toHaveURL(/\/assessments\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Publish assessment', exact: true })
    .click();
  await expect(page.getByText('SCHEDULED', { exact: true })).toBeVisible();
  await expect(page.getByText('Assigned students').locator('..')).toContainText('3');
  await page.getByRole('tab', { name: 'Live monitoring' }).click();
  for (const source of ['single', 'csv', 'xlsx'])
    await expect(page.getByRole('cell').filter({ hasText: `${prefix}-${source}` })).toBeVisible();
  await page.screenshot({ path: `artifacts/institution-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
