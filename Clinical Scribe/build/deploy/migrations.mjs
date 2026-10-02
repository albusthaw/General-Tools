// Database changes (migrations) must never lose stored records. The deploy checks
// every migration file before it updates the database, and the unit tests use the
// same rules.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function migrationsDir(root) {
  return join(root, "supabase", "migrations");
}

export function migrationFiles(root) {
  return readdirSync(migrationsDir(root)).filter((name) => name.endsWith(".sql")).sort();
}

/** Fingerprint of a migration, the same on Windows and Linux line endings. */
export function digest(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

// The SQL that runs when the migration is applied: comments, quoted text and
// function bodies are removed, then the rest is split into statements.
export function topLevelStatements(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += "''";
      i = j + 1;
    } else if (/^\$[A-Za-z_]*\$/.test(rest)) {
      const tag = rest.match(/^\$[A-Za-z_]*\$/)[0];
      const end = sql.indexOf(tag, i + tag.length);
      out += "$body$";
      i = end < 0 ? sql.length : end + tag.length;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out.split(";").map((statement) => statement.replace(/\s+/g, " ").trim()).filter(Boolean);
}

const LOSES_DATA = [
  /^drop (table|schema|materialized view|type|database)\b/i,
  /^truncate\b/i,
  /^delete from\b/i,
  /^alter table\b.*\bdrop (column\b|constraint\b.*\bprimary\b)/i,
  /^alter table\b.*\btype\b.*\busing\b/i,
];

/**
 * Statements that would drop or empty a table, delete rows or drop a column. A file
 * marked "-- cs:data-change-reviewed" after a careful review is allowed.
 */
export function riskyStatements(sql) {
  if (/--\s*cs:data-change-reviewed/i.test(sql)) return [];
  return topLevelStatements(sql).filter((statement) => LOSES_DATA.some((pattern) => pattern.test(statement)));
}

/** Every migration with statements that would lose data, as { file, statements }. */
export function riskyMigrations(root) {
  return migrationFiles(root)
    .map((file) => ({ file, statements: riskyStatements(readFileSync(join(migrationsDir(root), file), "utf8")) }))
    .filter((found) => found.statements.length > 0);
}
