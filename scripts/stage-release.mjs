// Turns a signed Windows build into the two files a release publishes:
//
//   release/Uptime_Installer.exe   the one download link anyone is given. The
//                                  name never carries a version, so
//                                  .../releases/latest/download/Uptime_Installer.exe
//                                  always means "the current build".
//   release/latest.json            the feed installed copies poll (see
//                                  plugins.updater in src-tauri/tauri.conf.json).
//
// Run after `tauri build --bundles nsis --config src-tauri/tauri.release.conf.json`,
// which leaves Uptime_<version>_x64-setup.exe and its .sig in the NSIS bundle
// folder. The updater downloads the same installer a new user does: one file,
// one signature, no second artifact to drift out of step.
//
//   RELEASES_REPO   owner/name of the public repo the release goes to
//   RELEASE_NOTES   optional; shown nowhere yet, but kept in the feed

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const INSTALLER_NAME = "Uptime_Installer.exe";

/** The update feed, in the shape tauri-plugin-updater reads. */
export function latestJson({ version, signature, url, notes, pubDate }) {
  const entry = { signature, url };
  return {
    version,
    notes,
    // RFC 3339 without the milliseconds, which the updater has no use for.
    pub_date: pubDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
    // The updater looks for `<os>-<arch>-<installer>` first and falls back to
    // `<os>-<arch>`. Both point at the same file.
    platforms: {
      "windows-x86_64-nsis": entry,
      "windows-x86_64": entry,
    },
  };
}

export function stage({ root, repo, notes, now = new Date() }) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const bundle = join(root, "src-tauri", "target", "release", "bundle", "nsis");
  if (!existsSync(bundle)) throw new Error(`No NSIS bundle at ${bundle} - run the release build first.`);

  // Match on the version so a stale installer left in the folder by an older
  // local build can never be published under the new number.
  const installer = readdirSync(bundle).find(
    (name) => name.endsWith("-setup.exe") && name.includes(`_${version}_`),
  );
  if (!installer) throw new Error(`No ${version} installer in ${bundle}.`);
  const sigPath = join(bundle, `${installer}.sig`);
  if (!existsSync(sigPath)) {
    throw new Error(
      `${installer} is not signed. Build with --config src-tauri/tauri.release.conf.json and TAURI_SIGNING_PRIVATE_KEY set.`,
    );
  }

  const out = join(root, "release");
  mkdirSync(out, { recursive: true });
  copyFileSync(join(bundle, installer), join(out, INSTALLER_NAME));

  const feed = latestJson({
    version,
    signature: readFileSync(sigPath, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/v${version}/${INSTALLER_NAME}`,
    notes: notes || `Uptime ${version}`,
    pubDate: now,
  });
  writeFileSync(join(out, "latest.json"), JSON.stringify(feed, null, 2) + "\n");
  return { version, installer, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.RELEASES_REPO;
  if (!repo) throw new Error("Set RELEASES_REPO to the owner/name the release is published to.");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { version, installer, out } = stage({ root, repo, notes: process.env.RELEASE_NOTES });
  console.log(`Staged ${installer} as ${INSTALLER_NAME} for v${version} in ${out}`);
}
