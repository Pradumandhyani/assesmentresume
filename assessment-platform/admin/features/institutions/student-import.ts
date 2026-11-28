import { z } from 'zod';
import type { NewStudent } from '@/types/admin';

export const studentColumns = [
  'externalId',
  'displayName',
  'email',
  'password',
  'cohort',
  'course',
] as const;
const studentSchema = z.object({
  externalId: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z
    .string()
    .min(12)
    .max(1024)
    .refine((value) => new TextEncoder().encode(value).length <= 1024),
  cohort: z.string().trim().max(100),
  course: z.string().trim().min(1).max(100),
});

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell);
      cell = '';
      closed = false;
      if (c !== ',') {
        rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (c === '"' && cell === '' && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Invalid CSV quoting. Use the supplied template.');
      cell += c;
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted cell.');
  if (row.length || cell || closed) rows.push([...row, cell]);
  return rows;
}

export function studentsFromRows(rows: unknown[][]): NewStudent[] {
  const aliases: Record<string, string> = {
    studentid: 'externalId',
    externalid: 'externalId',
    name: 'displayName',
    displayname: 'displayName',
    email: 'email',
    password: 'password',
    cohort: 'cohort',
    course: 'course',
  };
  const headers = (rows[0] ?? []).map(
    (value) =>
      aliases[
        String(value ?? '')
          .trim()
          .toLowerCase()
          .replace(/[ _-]/g, '')
      ],
  );
  if (!headers.length || headers.some((v) => !v) || new Set(headers).size !== headers.length)
    throw new Error(
      'Use unique column headers from the template: externalId, displayName, email, password, cohort, course.',
    );
  for (const field of studentColumns.filter((v) => v !== 'cohort'))
    if (!headers.includes(field)) throw new Error(`Missing required column: ${field}.`);
  const students: NewStudent[] = [];
  const ids = new Set<string>(),
    emails = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    if (row.every((value) => value === null || value === undefined || value === '')) return;
    if (
      row.length > headers.length &&
      row.slice(headers.length).some((v) => v !== null && v !== '')
    )
      throw new Error(`Row ${index + 2}: more cells than column headers.`);
    const input: Record<string, unknown> = { cohort: '' };
    headers.forEach((field, i) => {
      input[field!] = row[i] ?? '';
    });
    const result = studentSchema.safeParse(input);
    if (!result.success) {
      const issue = result.error.issues[0]!;
      throw new Error(
        `Row ${index + 2}, ${String(issue.path[0])}: ${issue.message}. Store IDs and passwords as text in Excel.`,
      );
    }
    if (ids.has(result.data.externalId) || emails.has(result.data.email))
      throw new Error(`Row ${index + 2}: duplicate student ID or email in this file.`);
    ids.add(result.data.externalId);
    emails.add(result.data.email);
    students.push(result.data);
  });
  if (!students.length || students.length > 500)
    throw new Error('Include between 1 and 500 students per file.');
  return students;
}

export async function readStudentFile(file: File): Promise<NewStudent[]> {
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose a file smaller than 2 MB.');
  if (/\.csv$/i.test(file.name)) return studentsFromRows(parseCsv(await file.text()));
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import('read-excel-file');
    let rows: unknown[][];
    try {
      rows = await readXlsxFile(file);
    } catch {
      throw new Error('Unable to read this Excel workbook. Save it as .xlsx and retry.');
    }
    return studentsFromRows(rows);
  }
  throw new Error('Choose a CSV (.csv) or Excel (.xlsx) file.');
}
