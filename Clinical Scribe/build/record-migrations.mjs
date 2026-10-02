// Run when releasing a new version: records the fingerprint of every migration in
// tests/unit/released-migrations.json, so the tests can tell if a released one is
// ever edited.   node build/record-migrations.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, migrationFiles, migrationsDir } from "./deploy/migrations.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = join(root, "tests", "unit", "released-migrations.json");
const recorded = {};
for (const file of migrationFiles(root)) recorded[file] = digest(readFileSync(join(migrationsDir(root), file), "utf8"));
writeFileSync(target, `${JSON.stringify(recorded, null, 2)}\n`);
console.log(`Recorded ${Object.keys(recorded).length} migrations in tests/unit/released-migrations.json.`);
