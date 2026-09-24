// Ships a new version of the desktop app from the command line:
//
//   npm run release            # 0.1.0 -> 0.1.1
//   npm run release -- minor   # 0.1.0 -> 0.2.0
//   npm run release -- major   # 0.1.0 -> 1.0.0
//   npm run release -- 0.4.2   # an exact version
//   npm run release -- --check # run every check below, change nothing
//
// It bumps package.json, commits, tags vX.Y.Z and pushes both. The tag starts
// .github/workflows/release.yml, which builds and signs Uptime_Installer.exe
// and Uptime_Installer.msi on a Windows runner and publishes them as a GitHub
// release. Nothing is built locally, so a machine that cannot build can still
// ship. With the GitHub CLI signed in, it then follows the build to the end
// and prints the download links.
//
// Before touching anything it checks that the tree is clean, that you are on
// main and level with origin, that the tests pass, and - with the GitHub CLI -
// that the build's signing secrets and backend variables exist and the app's
// update feed points at the repo the release goes to. A tag that fails in CI burns a version number, and
// v0.1.2 went exactly that way: pushed to a build that had no signing key.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BRANCH = "main";
const BUMPS = ["patch", "minor", "major"];
const WORKFLOW = "release.yml";
const SECRETS = ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"];
/** Variables (or secrets) the build reads to talk to the real backend. */
const BACKEND = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts })?.trim();
}
const git = (...args) => run("git", args);
// npm is a .cmd shim on Windows, which only starts through a shell. Keep its
// arguments free of spaces: the shell would split them.
const npm = (...args) => run("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
const gh = (...args) => run("gh", args, { stdio: ["ignore", "pipe", "pipe"] });

const checkOnly = process.argv.includes("--check");
let problems = 0;

/** Stop here - or, with --check, note it and carry on to report the rest. */
function fail(message) {
  if (checkOnly) {
    console.error(`\n${message}`);
    problems += 1;
    return;
  }
  console.error(`\n${message}\nNothing was released.`);
  process.exit(1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The GitHub CLI, signed in - or null, and the checks that need it are skipped. */
function githubCli() {
  try {
    gh("auth", "status");
    return gh;
  } catch {
    return null;
  }
}

const bump = process.argv.slice(2).find((arg) => arg !== "--check") || "patch";
if (!BUMPS.includes(bump) && !/^\d+\.\d+\.\d+$/.test(bump)) {
  fail(`Unknown version "${bump}". Use patch, minor, major or an exact X.Y.Z.`);
}

if (git("status", "--porcelain")) fail("You have uncommitted changes. Commit or stash them first.");

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== BRANCH) fail(`You are on "${branch}". Releases go out from ${BRANCH}: git checkout ${BRANCH}`);

console.log(`Fetching origin/${BRANCH}...`);
git("fetch", "origin", BRANCH, "--tags");
const [behind, ahead] = git("rev-list", "--left-right", "--count", `origin/${BRANCH}...HEAD`)
  .split(/\s+/)
  .map(Number);
if (behind) fail(`${BRANCH} is ${behind} commit(s) behind origin. Run: git pull`);

// The repo's real name, not the remote's spelling of it: a renamed or moved
// repo still answers at its old URL, but its releases live under the new one.
const cli = githubCli();
const slug = cli
  ? cli("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner")
  : git("remote", "get-url", "origin")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^https:\/\/github\.com\//, "")
      .replace(/\.git$/, "");

if (cli) {
  console.log(`Checking ${slug} is set up to build a release...`);

  let secrets = [];
  try {
    secrets = cli("secret", "list", "--repo", slug, "--json", "name", "--jq", ".[].name").split(/\s+/);
  } catch (err) {
    fail(`Could not read the secrets of ${slug}: ${err.stderr || err.message}`);
  }
  const missing = SECRETS.filter((name) => !secrets.includes(name));
  if (missing.length > 0) {
    fail(
      `The release build signs the installers with a key that is not on GitHub yet.\n` +
        `Missing secret(s) on ${slug}: ${missing.join(", ")}.\n` +
        `See README.md, "Releasing the desktop app" - it is two commands.`,
    );
  }

  let vars = [];
  try {
    vars = JSON.parse(cli("variable", "list", "--repo", slug, "--json", "name,value"));
  } catch {
    // No permission to list them; the checks below then assume none are set.
  }

  // A build without the backend's address runs the offline demo - the seeded
  // cast on browser storage - and that is not something to hand to people.
  const backend = BACKEND.filter((name) => !vars.some((v) => v.name === name) && !secrets.includes(name));
  if (backend.length > 0) {
    fail(
      `The release would run the offline demo, not your Supabase project.\n` +
        `Missing Actions variable(s) on ${slug}: ${backend.join(", ")} - the same values as .env.\n` +
        `See README.md, "Releasing the desktop app".`,
    );
  }

  // Installed copies only ever look where tauri.conf.json tells them to.
  const target = vars.find((v) => v.name === "RELEASES_REPO")?.value || slug;
  const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const feed = tauri.plugins?.updater?.endpoints?.[0] ?? "";
  if (!feed.toLowerCase().startsWith(`https://github.com/${target}/releases/`.toLowerCase())) {
    fail(
      `This release would be published to ${target}, but installed copies look for updates at\n` +
        `  ${feed}\n` +
        `Point plugins.updater.endpoints in src-tauri/tauri.conf.json at\n` +
        `  https://github.com/${target}/releases/latest/download/latest.json`,
    );
  }
} else {
  console.warn(
    "\nThe GitHub CLI is not signed in (gh auth login), so the build's secrets cannot be\n" +
      "checked first. If they are missing, the build fails and this version number is spent.\n",
  );
}

console.log("Running the tests...");
try {
  npm("test");
} catch {
  fail("Tests failed.");
}

if (checkOnly) {
  const next = JSON.parse(readFileSync("package.json", "utf8")).version;
  console.log(
    problems === 0
      ? `\nReady: npm run release${bump === "patch" ? "" : ` -- ${bump}`} would ship the version after ${next}.`
      : `\n${problems} thing(s) to fix before npm run release will work.`,
  );
  process.exit(problems === 0 ? 0 : 1);
}

const from = JSON.parse(readFileSync("package.json", "utf8")).version;
// Commits package.json and package-lock.json, and tags the commit vX.Y.Z.
npm("version", bump);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;

console.log(`\nPushing ${tag}${ahead ? ` and ${ahead} earlier commit(s)` : ""}...`);
try {
  git("push", "origin", BRANCH);
  git("push", "origin", tag);
} catch (err) {
  console.error(err.stderr || err.message);
  fail(
    `The push failed, so ${tag} exists only on this machine. Fix the cause, then run:\n` +
      `  git push origin ${BRANCH} && git push origin ${tag}`,
  );
}

const actions = `https://github.com/${slug}/actions/workflows/${WORKFLOW}`;
console.log(`\n${from} -> ${version} is on its way.`);

if (!cli) {
  console.log(`Build:   ${actions}`);
  console.log("Once it finishes, installed copies pick it up on their next update check.");
  process.exit(0);
}

// Follow the build, so "released" means the installers are downloadable
// rather than that a tag was pushed. Ctrl+C stops watching, not the build.
console.log("Waiting for the build to start...");
let runId = "";
for (let attempt = 0; attempt < 30 && !runId; attempt++) {
  sleep(3000);
  try {
    runId = cli(
      "run", "list", "--repo", slug, "--workflow", WORKFLOW, "--branch", tag,
      "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId // empty",
    );
  } catch {
    // Not listed yet.
  }
}
if (!runId) {
  console.log(`The build has not shown up yet. Follow it here: ${actions}`);
  process.exit(0);
}

console.log(`Building on GitHub (about 15 minutes). Ctrl+C stops watching; the build carries on.\n`);
try {
  run("gh", ["run", "watch", runId, "--repo", slug, "--exit-status", "--interval", "30"], {
    stdio: "inherit",
  });
} catch {
  console.error(
    `\nThe build failed: https://github.com/${slug}/actions/runs/${runId}\n` +
      `${tag} is pushed but not released. Once the cause is fixed on ${BRANCH}, release the\n` +
      `same version from Actions > Release > Run workflow - no new version number needed.`,
  );
  process.exit(1);
}

const latest = `https://github.com/${slug}/releases/latest/download`;
console.log(`\nUptime ${version} is out: https://github.com/${slug}/releases/tag/${tag}`);
console.log(`  ${latest}/Uptime_Installer.exe`);
console.log(`  ${latest}/Uptime_Installer.msi`);
console.log("Installed copies pick it up on their next update check, or from Account > App > Updates.");
