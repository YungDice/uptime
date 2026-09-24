// Ships a new version of the desktop app from the command line:
//
//   npm run release            # 0.1.0 -> 0.1.1
//   npm run release -- minor   # 0.1.0 -> 0.2.0
//   npm run release -- major   # 0.1.0 -> 1.0.0
//   npm run release -- 0.4.2   # an exact version
//
// It bumps package.json, commits, tags vX.Y.Z and pushes both. The tag starts
// .github/workflows/release.yml, which builds and signs the installer on a
// Windows runner and publishes it to the releases repo. Nothing is built
// locally, so a machine that cannot build can still ship.
//
// Before touching anything it checks that the tree is clean, that you are on
// main and level with origin, and that the tests pass - a tag that fails in CI
// burns a version number.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BRANCH = "main";
const BUMPS = ["patch", "minor", "major"];

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts })?.trim();
}
const git = (...args) => run("git", args);
// npm is a .cmd shim on Windows, which only starts through a shell. Keep its
// arguments free of spaces: the shell would split them.
const npm = (...args) => run("npm", args, { stdio: "inherit", shell: process.platform === "win32" });

function fail(message) {
  console.error(`\n${message}\nNothing was released.`);
  process.exit(1);
}

const bump = process.argv[2] || "patch";
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

console.log("Running the tests...");
try {
  npm("test");
} catch {
  fail("Tests failed.");
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

const repo = git("remote", "get-url", "origin")
  .replace(/^git@github\.com:/, "https://github.com/")
  .replace(/\.git$/, "");
console.log(`\n${from} -> ${version} is on its way.`);
console.log(`Build:   ${repo}/actions/workflows/release.yml`);
console.log("Once it finishes, installed copies pick it up on their next update check.");
