import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL(
    '../backend/prisma/migrations/20261011000000_new_install_only/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

test(
  'new-install migration guards existing users without altering them',
  { timeout: 60_000 },
  async () => {
    const db = new PGlite();
    try {
      await db.exec(
        "CREATE TABLE users (legacy_id integer PRIMARY KEY, marker text); INSERT INTO users VALUES (7, 'existing-identity');",
      );
      await assert.rejects(db.exec(migration), /Existing users table detected/);
      await db.exec('ROLLBACK');
      assert.deepEqual((await db.query('SELECT * FROM users')).rows, [
        { legacy_id: 7, marker: 'existing-identity' },
      ]);
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
          )
        ).rows[0].count,
        1,
      );
    } finally {
      await db.close();
    }
  },
);

test(
  'migration executes and enforces immutable versions, schedule and allocations',
  { timeout: 60_000 },
  async (t) => {
    const db = new PGlite();
    try {
      await db.exec(migration);
      const version = (await db.query('SELECT version() AS version')).rows[0].version;
      t.diagnostic(`Isolated in-memory runtime: ${version}`);
      const adminUser = randomUUID(),
        studentUser = randomUUID(),
        admin = randomUUID(),
        student = randomUUID();
      // Only isolated test fixtures; no app login, seed script or production connection exists.
      await db.query(
        "INSERT INTO users(id,email,password_hash,role,updated_at) VALUES ($1,'admin@example.invalid','test-fixture','ADMIN',now()),($2,'student@example.invalid','test-fixture','STUDENT',now())",
        [adminUser, studentUser],
      );
      await db.query('INSERT INTO admins(id,user_id,display_name) VALUES ($1,$2,$3)', [
        admin,
        adminUser,
        'Fixture administrator',
      ]);
      await db.query(
        'INSERT INTO students(id,user_id,external_id,display_name) VALUES ($1,$2,$3,$4)',
        [student, studentUser, 'fixture-student', 'Fixture student'],
      );
      const versions = [];
      for (const [index, difficulty] of ['EASY', 'EASY', 'MEDIUM', 'HARD'].entries()) {
        const questionId = randomUUID(),
          versionId = randomUUID();
        await db.query('INSERT INTO questions(id,slug) VALUES ($1,$2)', [
          questionId,
          `fixture-${index}`,
        ]);
        await db.query(
          'INSERT INTO question_versions(id,question_id,version,title,difficulty,statement,input_format,output_format,constraints,created_by_id) VALUES ($1,$2,1,$3,$4,$5,$5,$5,$5,$6)',
          [versionId, questionId, `Fixture ${index}`, difficulty, 'fixture text', admin],
        );
        for (const language of ['PYTHON', 'JAVA', 'CPP'])
          await db.query(
            'INSERT INTO question_templates(id,question_version_id,language,starter_code,toolchain_id) VALUES ($1,$2,$3,$4,$5)',
            [randomUUID(), versionId, language, 'fixture starter', 'fixture-pinned-toolchain'],
          );
        for (const [ordinal, visibility] of [
          [1, 'PUBLIC'],
          [2, 'HIDDEN'],
        ])
          await db.query(
            'INSERT INTO test_cases(id,question_version_id,ordinal,visibility,input_ciphertext,expected_output_ciphertext,encryption_key_id,integrity_hash) VALUES ($1,$2,$3,$4,$5,$5,$6,$7)',
            [
              randomUUID(),
              versionId,
              ordinal,
              visibility,
              new Uint8Array([1, 2, 3]),
              'test-only-key',
              'a'.repeat(64),
            ],
          );
        await db.query(
          "UPDATE question_versions SET status='PUBLISHED',content_hash=$2,published_at=now() WHERE id=$1",
          [versionId, 'a'.repeat(64)],
        );
        versions.push({ questionId, versionId });
      }
      await t.test('published parent and children reject edits and additions', async () => {
        await assert.rejects(
          db.query('UPDATE question_versions SET title=$2 WHERE id=$1', [
            versions[0].versionId,
            'mutated',
          ]),
          /immutable/,
        );
        await assert.rejects(
          db.query('UPDATE question_templates SET starter_code=$2 WHERE question_version_id=$1', [
            versions[0].versionId,
            'mutated',
          ]),
          /immutable/,
        );
        await assert.rejects(
          db.query('DELETE FROM test_cases WHERE question_version_id=$1', [versions[0].versionId]),
          /immutable/,
        );
        await assert.rejects(
          db.query(
            "INSERT INTO test_cases(id,question_version_id,ordinal,visibility,input_ciphertext,expected_output_ciphertext,encryption_key_id,integrity_hash) VALUES($1,$2,3,'HIDDEN',$3,$3,'fixture',$4)",
            [randomUUID(), versions[0].versionId, new Uint8Array([1]), 'b'.repeat(64)],
          ),
          /immutable/,
        );
      });
      await t.test('public envelope view excludes hidden cases', async () => {
        const visible = (await db.query('SELECT ordinal FROM public_test_case_envelopes')).rows;
        assert.equal(visible.length, 4);
        assert.ok(visible.every((row) => row.ordinal === 1));
      });
      const assessment = randomUUID();
      await db.query(
        'INSERT INTO assessments(id,title,created_by_id,updated_at) VALUES ($1,$2,$3,now())',
        [assessment, 'Fixture assessment', admin],
      );
      const rule = randomUUID();
      await db.query('INSERT INTO assessment_rules(id,assessment_id) VALUES ($1,$2)', [
        rule,
        assessment,
      ]);
      await t.test('database refuses a different exam duration', async () => {
        await assert.rejects(
          db.query('UPDATE assessment_rules SET duration_seconds=60 WHERE id=$1', [rule]),
          /fixed_exam_rule/,
        );
      });
      for (const item of versions)
        await db.query(
          'INSERT INTO assessment_pool_questions(assessment_id,question_version_id,question_id) VALUES($1,$2,$3)',
          [assessment, item.versionId, item.questionId],
        );
      await db.query(
        "UPDATE assessments SET status='SCHEDULED',opens_at='2026-10-11T08:00:00Z',latest_start_at='2026-10-11T08:30:00Z',closes_at='2026-10-11T11:30:00Z',results_release_at='2026-10-11T12:00:00Z' WHERE id=$1",
        [assessment],
      );
      await t.test('scheduled rules and pool cannot change', async () => {
        await assert.rejects(
          db.query('UPDATE assessment_rules SET max_source_bytes=100 WHERE assessment_id=$1', [
            assessment,
          ]),
          /frozen/,
        );
        await assert.rejects(
          db.query('DELETE FROM assessment_pool_questions WHERE assessment_id=$1', [assessment]),
          /frozen/,
        );
        await assert.rejects(
          db.query("UPDATE assessments SET opens_at=opens_at+interval '1 minute' WHERE id=$1", [
            assessment,
          ]),
          /immutable/,
        );
      });
      const assignment = randomUUID();
      await db.query(
        'INSERT INTO assessment_assignments(id,assessment_id,student_id) VALUES($1,$2,$3)',
        [assignment, assessment, student],
      );
      async function insertAttempt(tx, id, items) {
        await tx.query(
          "INSERT INTO assessment_attempts(id,assignment_id,student_id,assessment_id,started_at,expires_at,rule_snapshot,allocation_manifest_hash) VALUES($1,$2,$3,$4,'2026-10-11T08:00:00Z','2026-10-11T11:00:00Z','{}',$5)",
          [id, assignment, student, assessment, 'c'.repeat(64)],
        );
        const allocated = [];
        for (const [position, item] of items.entries()) {
          const question = randomUUID();
          await tx.query(
            'INSERT INTO attempt_questions(id,attempt_id,assessment_id,question_id,question_version_id,position) VALUES($1,$2,$3,$4,$5,$6)',
            [question, id, assessment, item.questionId, item.versionId, position + 1],
          );
          allocated.push(question);
        }
        return allocated;
      }
      await t.test('partial allocation cannot commit', async () => {
        await assert.rejects(
          db.transaction((tx) => insertAttempt(tx, randomUUID(), versions.slice(0, 3))),
          /exactly 2 easy/,
        );
        assert.equal(
          (await db.query('SELECT count(*)::int AS count FROM assessment_attempts')).rows[0].count,
          0,
        );
      });
      const attempt = randomUUID();
      const allocated = await db.transaction((tx) => insertAttempt(tx, attempt, versions));
      await t.test('full allocation commits once and cannot be reshuffled', async () => {
        assert.equal(
          (await db.query('SELECT count(*)::int AS count FROM attempt_questions')).rows[0].count,
          4,
        );
        await assert.rejects(
          db.transaction((tx) => insertAttempt(tx, randomUUID(), versions)),
          /unique constraint/,
        );
        await assert.rejects(
          db.query('UPDATE attempt_questions SET position=4 WHERE id=$1', [allocated[0]]),
          /immutable/,
        );
        await assert.rejects(
          db.query(
            "UPDATE assessment_attempts SET started_at=started_at+interval '1 hour',expires_at=expires_at+interval '1 hour' WHERE id=$1",
            [attempt],
          ),
          /immutable/,
        );
      });
      const submission = randomUUID();
      await db.query(
        "INSERT INTO submissions(id,attempt_question_id,attempt_id,question_version_id,purpose,language,source_code,source_hash,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'FINAL','PYTHON','fixture',$5,'fixture-final-key-1',$5)",
        [submission, allocated[0], attempt, versions[0].versionId, 'd'.repeat(64)],
      );
      await t.test('submission source and final ownership are protected', async () => {
        await assert.rejects(
          db.query('UPDATE submissions SET source_code=$2 WHERE id=$1', [submission, 'tampered']),
          /immutable/,
        );
        await assert.rejects(
          db.query('UPDATE attempt_questions SET final_submission_id=$2 WHERE id=$1', [
            allocated[1],
            submission,
          ]),
          /must belong/,
        );
        await db.query('UPDATE attempt_questions SET final_submission_id=$2 WHERE id=$1', [
          allocated[0],
          submission,
        ]);
      });
      await t.test('audit history cannot be rewritten', async () => {
        const audit = randomUUID();
        await db.query(
          "INSERT INTO audit_logs(id,actor_user_id,action,entity_type,request_id,metadata) VALUES($1,$2,'fixture','assessment',$3,'{}')",
          [audit, adminUser, randomUUID()],
        );
        await assert.rejects(
          db.query('DELETE FROM audit_logs WHERE id=$1', [audit]),
          /append only/,
        );
      });
    } finally {
      await db.close();
    }
  },
);
