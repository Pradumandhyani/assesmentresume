import { describe, expect, it, vi } from 'vitest';
import { studentWorkbook } from '../../test/support/student-workbook';
import {
  parseCsv,
  readStudentFile,
  studentsFromRows,
} from '@/features/institutions/student-import';
const header = ['externalId', 'displayName', 'email', 'password', 'cohort', 'course'];
const row = [
  '001',
  'Student One',
  'ONE@example.test',
  'student-password-123',
  '2026',
  'B.Tech CSE',
];
describe('student file parsing and validation', () => {
  it('reads an actual Excel workbook and preserves text student IDs', async () => {
    const bytes = new Uint8Array(studentWorkbook('000123')).buffer;
    const file = new File([bytes], 'students.xlsx');
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes) });
    await expect(readStudentFile(file)).resolves.toMatchObject([
      { externalId: '000123', displayName: 'Excel Student' },
    ]);
  });
  it('reads BOM, escaped quotes, commas, multiline fields and CRLF without changing passwords or IDs', () => {
    const text =
      '\uFEFFexternalId,displayName,email,password,cohort,course\r\n001,"One, ""Student""",ONE@example.test,"keep\npassword-123",2026,B.Tech CSE\r\n';
    const [student] = studentsFromRows(parseCsv(text));
    expect(student).toEqual({
      externalId: '001',
      displayName: 'One, "Student"',
      email: 'one@example.test',
      password: 'keep\npassword-123',
      cohort: '2026',
      course: 'B.Tech CSE',
    });
  });
  it('accepts column aliases, optional cohort and empty lines', () => {
    expect(
      studentsFromRows([
        ['Student ID', 'Name', 'Email', 'Password', 'Course'],
        [...row.slice(0, 4), 'B.Tech CSE'],
        [],
      ])[0],
    ).toMatchObject({ externalId: '001', cohort: '' });
  });
  it('reports bad rows and duplicate IDs/emails before submission', () => {
    expect(() => studentsFromRows([header, row, ['002', 'Two', 'bad-email', row[3]]])).toThrow(
      'Row 3, email',
    );
    expect(() => studentsFromRows([header, row, row])).toThrow('Row 3: duplicate');
    expect(() =>
      studentsFromRows([header, row, ['002', 'Two', 'one@EXAMPLE.test', row[3], '', 'B.Tech CSE']]),
    ).toThrow('Row 3: duplicate');
    expect(() => studentsFromRows([header, [1, ...row.slice(1)]])).toThrow(
      'Store IDs and passwords as text',
    );
    expect(() => studentsFromRows([header, [...row.slice(0, 3), 'short']])).toThrow('password');
  });
  it('rejects missing, duplicate or unknown headers, empty files and malformed CSV', () => {
    expect(() => studentsFromRows([['externalId']])).toThrow('Missing required column');
    expect(() => studentsFromRows([[...header, 'email']])).toThrow('unique column headers');
    expect(() => studentsFromRows([[...header, 'unrecognized']])).toThrow('unique column headers');
    expect(() => studentsFromRows([header])).toThrow('between 1 and 500');
    expect(() => parseCsv('one,"unclosed')).toThrow('unclosed');
    expect(() => parseCsv('one,"closed"junk')).toThrow('Invalid CSV quoting');
  });
  it('rejects oversized batches, unsupported files and files over 2 MB', async () => {
    expect(() =>
      studentsFromRows([
        header,
        ...Array.from({ length: 501 }, (_, i) => [
          `ID-${i}`,
          'Student',
          `${i}@example.test`,
          row[3],
          '',
          'B.Tech CSE',
        ]),
      ]),
    ).toThrow('between 1 and 500');
    await expect(readStudentFile(new File([''], 'students.xls'))).rejects.toThrow(
      'CSV (.csv) or Excel (.xlsx)',
    );
    await expect(
      readStudentFile(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'students.csv')),
    ).rejects.toThrow('2 MB');
  });
  it('passes CSV files through the same validation as worksheets', async () => {
    const file = new File([], 'students.csv');
    Object.defineProperty(file, 'text', {
      value: vi.fn().mockResolvedValue([header, row].map((r) => r.join(',')).join('\n')),
    });
    await expect(readStudentFile(file)).resolves.toMatchObject([
      { externalId: '001', email: 'one@example.test' },
    ]);
  });
});
