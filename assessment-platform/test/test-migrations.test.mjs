import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from './support/migrations.cjs';

test('test databases apply every checked-in migration, including institution membership', async () => {
  const database = await PGlite.create();
  try {
    await applyMigrations(database);
    await database.query(
      'SELECT institution_id, name, main_faculty, email, phone FROM institutions',
    );
    await database.query('SELECT institution_id FROM students');
    const result =
      await database.query(`SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name='students' AND constraint_name='students_institution_id_fkey'`);
    assert.equal(result.rows.length, 1);
  } finally {
    await database.close();
  }
});

test('new migration directories are discovered in order and missing SQL fails the setup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'assessment-migrations-'));
  try {
    const create = (name, sql) => {
      mkdirSync(join(directory, name));
      writeFileSync(join(directory, name, 'migration.sql'), sql);
    };
    create('20270102000000_later', 'second');
    create('20270101000000_first', 'first');
    writeFileSync(join(directory, 'migration_lock.toml'), 'provider="postgresql"');
    mkdirSync(join(directory, 'notes'));
    const applied = [];
    const database = {
      exec: async (sql) => {
        applied.push(sql);
      },
    };
    await applyMigrations(database, directory);
    assert.deepEqual(applied, ['first', 'second']);
    mkdirSync(join(directory, '20270103000000_missing'));
    await assert.rejects(applyMigrations(database, directory), /ENOENT/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('assessment-migrations-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
