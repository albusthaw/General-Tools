// Upgrades must never lose data. These checks run before every deploy:
// - no migration may drop or empty a table, delete rows or drop a column at the top
//   level (code inside functions is not affected), unless the file is marked
//   "-- cs:data-change-reviewed" after a careful review;
// - a migration that has been released is never edited, because the server would
//   ignore the change (it only applies new files);
// - new migrations sort after every released one.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest, migrationFiles, migrationsDir, riskyMigrations, riskyStatements } from "../../build/deploy/migrations.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RELEASED = JSON.parse(readFileSync(new URL("./released-migrations.json", import.meta.url), "utf8"));
const files = migrationFiles(ROOT);

test("the checker finds data-losing statements but ignores function bodies and comments", () => {
  const sql = [
    "-- drop table public.notes;",
    "create function f() returns void language sql as $$ delete from public.notes; $$;",
    "create function g() returns void language plpgsql as $body$ begin truncate public.jobs; end; $body$;",
    "insert into t (a) values ('drop table x; delete from y');",
    "drop policy if exists p on public.notes;",
    "drop table public.notes;",
    "ALTER TABLE public.scribes DROP COLUMN transcript;",
    "delete from public.jobs where true",
  ].join("\n");
  assert.deepEqual(riskyStatements(sql), [
    "drop table public.notes",
    "ALTER TABLE public.scribes DROP COLUMN transcript",
    "delete from public.jobs where true",
  ]);
  assert.deepEqual(riskyStatements(`-- cs:data-change-reviewed: moving notes\n${sql}`), []);
});

test("the deploy's check names the migration that would lose data", () => {
  const root = mkdtempSync(join(tmpdir(), "cs-migrations-"));
  mkdirSync(migrationsDir(root), { recursive: true });
  writeFileSync(join(migrationsDir(root), "20270101000000_safe.sql"), "create table public.extra (id int);\n");
  writeFileSync(join(migrationsDir(root), "20270101000100_tidy.sql"), "truncate public.audit_log;\n");
  assert.deepEqual(riskyMigrations(root), [{ file: "20270101000100_tidy.sql", statements: ["truncate public.audit_log"] }]);
});

test("no migration drops, empties or deletes stored data", () => {
  assert.deepEqual(riskyMigrations(ROOT), []);
});

test("released migrations are never edited", () => {
  for (const [name, hash] of Object.entries(RELEASED)) {
    assert.ok(files.includes(name), `${name} was released and must not be removed or renamed`);
    assert.equal(digest(readFileSync(join(migrationsDir(ROOT), name), "utf8")), hash, `${name} was released and must not be edited; put the change in a new migration`);
  }
});

test("new migrations sort after every released one", () => {
  const lastReleased = Object.keys(RELEASED).sort().pop();
  for (const name of files.filter((file) => !Object.hasOwn(RELEASED, file))) {
    assert.ok(name > lastReleased, `${name} must have a later date than ${lastReleased}`);
    assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/, `${name} should be named <date and time>_<what it does>.sql`);
  }
});
