// Turns a signed Windows build into the files a release publishes:
//
//   release/Uptime_Installer.exe   the download link anyone is given. The name
//                                  never carries a version, so
//                                  .../releases/latest/download/Uptime_Installer.exe
//                                  always means "the current build".
//   release/Uptime_Installer.msi   the same app as a Windows Installer package,
//                                  for people and IT departments that want one.
//   release/latest.json            the feed installed copies poll (see
//                                  plugins.updater in src-tauri/tauri.conf.json).
//
// Run after `tauri build --bundles nsis,msi --config src-tauri/tauri.release.conf.json`,
// which leaves each installer and its .sig in the bundle's own folder. An
// installed copy updates from the same kind of installer it was installed
// with: the updater knows which it is and looks up `windows-x86_64-nsis` or
// `windows-x86_64-msi` in the feed, so the two never cross over.
//
//   RELEASES_REPO   owner/name of the repo the release is published to
//   RELEASE_NOTES   optional; shown nowhere yet, but kept in the feed

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const INSTALLER_NAME = "Uptime_Installer.exe";
export const MSI_NAME = "Uptime_Installer.msi";

/** The update feed, in the shape tauri-plugin-updater reads. */
export function latestJson({ version, notes, pubDate, nsis, msi }) {
  return {
    version,
    notes,
    // RFC 3339 without the milliseconds, which the updater has no use for.
    pub_date: pubDate.toISOString().replace(/\.\d{3}Z$/, "Z"),
    // The updater looks for `<os>-<arch>-<installer>` first and falls back to
    // `<os>-<arch>`. The fallback is the NSIS installer, the one the download
    // link hands out.
    platforms: {
      "windows-x86_64-nsis": nsis,
      "windows-x86_64-msi": msi,
      "windows-x86_64": nsis,
    },
  };
}

/**
 * One signed installer of this version in `folder`.
 *
 * Matched on the version so a stale installer left in the folder by an older
 * local build can never be published under the new number.
 */
function signedInstaller(folder, version, suffix, kind) {
  if (!existsSync(folder)) {
    throw new Error(`No ${kind} bundle at ${folder} - run the release build first.`);
  }
  const name = readdirSync(folder).find((file) => file.endsWith(suffix) && file.includes(`_${version}_`));
  if (!name) throw new Error(`No ${version} ${kind} installer in ${folder}.`);
  const sigPath = join(folder, `${name}.sig`);
  if (!existsSync(sigPath)) {
    throw new Error(
      `${name} is not signed. Build with --config src-tauri/tauri.release.conf.json and TAURI_SIGNING_PRIVATE_KEY set.`,
    );
  }
  return { path: join(folder, name), name, signature: readFileSync(sigPath, "utf8").trim() };
}

export function stage({ root, repo, notes, now = new Date() }) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const bundles = join(root, "src-tauri", "target", "release", "bundle");
  const nsis = signedInstaller(join(bundles, "nsis"), version, "-setup.exe", "NSIS");
  const msi = signedInstaller(join(bundles, "msi"), version, ".msi", "MSI");

  const out = join(root, "release");
  mkdirSync(out, { recursive: true });
  copyFileSync(nsis.path, join(out, INSTALLER_NAME));
  copyFileSync(msi.path, join(out, MSI_NAME));

  const download = (name) => `https://github.com/${repo}/releases/download/v${version}/${name}`;
  const feed = latestJson({
    version,
    notes: notes || `Uptime ${version}`,
    pubDate: now,
    nsis: { signature: nsis.signature, url: download(INSTALLER_NAME) },
    msi: { signature: msi.signature, url: download(MSI_NAME) },
  });
  writeFileSync(join(out, "latest.json"), JSON.stringify(feed, null, 2) + "\n");
  return { version, installers: [nsis.name, msi.name], out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.RELEASES_REPO;
  if (!repo) throw new Error("Set RELEASES_REPO to the owner/name the release is published to.");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { version, installers, out } = stage({ root, repo, notes: process.env.RELEASE_NOTES });
  console.log(`Staged ${installers.join(" and ")} for v${version} in ${out}`);
}
