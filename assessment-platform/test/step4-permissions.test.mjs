import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('additive Step 4 migration and runtime groups enforce the hidden-storage boundary', async () => {
  const db = await PGlite.create();
  try {
    for (const name of [
      '20261011000000_new_install_only',
      '20261011010000_student_dashboard',
      '20261012000000_public_question_examples',
      '20261012010000_execution_lifecycle',
    '20261013000000_admin_management',
    ])
      await db.exec(
        readFileSync(
          new URL(`../backend/prisma/migrations/${name}/migration.sql`, import.meta.url),
          'utf8',
        ),
      );
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
