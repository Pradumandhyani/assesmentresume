import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from './support/migrations.cjs';

test('additive Step 4 migration and runtime groups enforce the hidden-storage boundary', async () => {
  const db = await PGlite.create();
  try {
    await applyMigrations(db);
    const grants = readFileSync(
      new URL('../backend/prisma/runtime-grants.sql', import.meta.url),
      'utf8',
    );
    await db.exec(grants);
    await db.exec(grants); // Safe to rerun; no password/credential operations.
    await db.exec('SET ROLE assessment_api');
    await assert.rejects(db.query('SELECT * FROM test_cases'), /permission denied/);
    await assert.rejects(
      db.query('SELECT internal_diagnostics_ciphertext FROM submission_results'),
      /permission denied/,
    );
    await db.query('SELECT verdict, score, public_case_results FROM submission_results');
    await assert.rejects(
      db.query('UPDATE question_versions SET title = title'),
      /permission denied/,
    );
    await assert.rejects(
      db
        .query('SELECT password_hash FROM users WHERE false')
        .then(() => db.query('DELETE FROM users WHERE false')),
      /permission denied/,
    );
    await db.exec('RESET ROLE; SET ROLE assessment_judge');
    await db.query('SELECT input_ciphertext FROM test_cases');
    await assert.rejects(db.query('SELECT password_hash FROM users'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE assessment_maintenance');
    await assert.rejects(db.query('SELECT * FROM test_cases'), /permission denied/);
    await assert.rejects(db.query('SELECT password_hash FROM users'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE assessment_admin');
    await db.query('SELECT email FROM users');
    await assert.rejects(db.query('SELECT password_hash FROM users'), /permission denied/);
    await db.query(`INSERT INTO institutions
      (id,institution_id,name,main_faculty,email,phone,updated_at)
      VALUES ('11111111-1111-4111-8111-111111111111','PERMISSION-TEST','College','Faculty','office@example.test','123',now())`);
    await db.query(`INSERT INTO users (id,email,password_hash,role,updated_at)
      VALUES ('22222222-2222-4222-8222-222222222222','student@example.test','test-hash','STUDENT',now())`);
    await db.query(`INSERT INTO students (id,user_id,external_id,display_name,institution_id)
      VALUES ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','PERMISSION-STUDENT','Student','11111111-1111-4111-8111-111111111111')`);
    await db.query('SELECT * FROM institutions');
    await db.query(
      "UPDATE students SET course='B.Tech CSE' WHERE external_id='PERMISSION-STUDENT'",
    );
    await db.exec('RESET ROLE');
    assert.equal(
      (
        await db.query(
          "SELECT count(*) AS count FROM pg_trigger WHERE tgname IN ('judge_result_boundary','submission_state_machine','immutable_grading_deadline')",
        )
      ).rows[0].count,
      3,
    );
  } finally {
    await db.close();
  }
});
