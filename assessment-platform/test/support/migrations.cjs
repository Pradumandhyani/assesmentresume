const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

/** Apply the complete checked-in Prisma history to an isolated test database. */
async function applyMigrations(
  database,
  directory = resolve(__dirname, '../../backend/prisma/migrations'),
) {
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (migrations.length === 0) throw new Error(`No migrations found in ${directory}`);
  for (const name of migrations)
    await database.exec(readFileSync(resolve(directory, name, 'migration.sql'), 'utf8'));
}

exports.applyMigrations = applyMigrations;
