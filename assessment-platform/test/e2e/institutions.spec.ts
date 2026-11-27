import { expect, test } from '@playwright/test';
import { studentWorkbook } from '../support/student-workbook';

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
  await page.getByRole('button', { name: 'Save student' }).click();
  await expect(page.getByRole('status')).toContainText('Student added');
  await expect(page.getByRole('cell', { name: `${prefix}-single`, exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Upload CSV / Excel' }).click();
  await page.getByLabel('Student file').setInputFiles({
    name: 'students.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `externalId,displayName,email,password,cohort\r\n${prefix}-csv,CSV Student,${prefix}-csv@example.test,Csv-password-123!,2026\r\n`,
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
  await page.screenshot({ path: `artifacts/institution-${info.project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
