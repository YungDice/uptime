// Regenerates supabase/deploy.sql from supabase/migrations/.
//
// deploy.sql is the paste-into-the-SQL-editor copy of every migration, for
// machines that cannot reach Postgres directly. It was maintained by hand and
// had already fallen a migration behind, so a project set up from it silently
// missed every change after 0011. Generating it means it cannot drift:
//
//   npm run db:bundle
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

const rule = "-- " + "=".repeat(74);

const header = `-- Uptime: complete schema, generated from supabase/migrations/.
--
-- Paste this whole file into the Supabase Dashboard SQL Editor and run it.
-- It is the same content as the numbered migrations, concatenated in order,
-- and exists because this machine cannot reach Postgres directly (outbound
-- 5432/6543 are blocked), so \`supabase db push\` cannot run from here.
--
-- Safe to re-run: every statement is CREATE OR REPLACE, CREATE IF NOT EXISTS,
-- or a DROP ... IF EXISTS followed by a CREATE. Re-running it on a database
-- that already has the earlier migrations applies only what changed.
--
-- Do not edit by hand: run \`npm run db:bundle\` after changing a migration.
--
-- Generated from:
${files.map((name) => `--   ${name}`).join("\n")}
`;

const sections = files.map((name) => {
  const body = readFileSync(join(dir, name), "utf8").replace(/\n+$/, "");
  return `${rule}\n-- ${name}\n${rule}\n\n${body}\n`;
});

writeFileSync(join(root, "supabase", "deploy.sql"), header + "\n" + sections.join("\n"));
console.log(`deploy.sql: ${files.length} migrations`);
