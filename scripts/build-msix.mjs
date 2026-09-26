// Builds the Microsoft Store package: release/Uptime_<version>_x64.msix.
//
//   npm run store:msix             build the Store copy of the app, then pack it
//   npm run store:msix -- --no-build   pack the uptime.exe already built
//
// The Store copy is the same app with the self-updater left out (the `store`
// Cargo feature, and VITE_UPTIME_STORE=microsoft for the frontend): it is
// installed into a folder only the Store may write to, and the Store updates
// it. Everything else - Supabase, invites, the Stripe upgrade - is unchanged.
//
// The package is not signed. Microsoft signs it after certification, which is
// the whole reason for this route: an EXE or MSI submitted to the Store must
// arrive already signed with a certificate bought from a CA.
//
// Windows only: it needs makeappx.exe and makepri.exe from the Windows SDK,
// and PowerShell to scale the icon. Both are on GitHub's windows runners.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The Store name, as reserved in Partner Center.
 *
 * Partner Center refuses a package whose display name is not one of the
 * names reserved for the app. The identity it assigned,
 * DiceEntertainment.UptimeStreakStopwatch, is made from this name.
 */
export const STORE_DISPLAY_NAME = "Uptime Streak Stopwatch";

/**
 * The images the manifest names, every scale and size Windows asks for.
 *
 * Each is qualified (`.scale-200`, `.targetsize-24`) and resources.pri maps
 * the plain names in the manifest to them, so Windows picks a sharp one for
 * each place: Start, the taskbar, Settings, the Store page. The `unplated`
 * sizes are what the taskbar and Start list use; without them Windows shrinks
 * the 44px tile image onto a coloured plate. The icon brings its own dark
 * rounded background, so plated and unplated are the same picture.
 */
export const ASSETS = [
  ...[1, 2, 4].map((k) => ({ file: `Square150x150Logo.scale-${k * 100}.png`, size: 150 * k })),
  ...[1, 2, 4].map((k) => ({ file: `Square44x44Logo.scale-${k * 100}.png`, size: 44 * k })),
  ...[16, 24, 32, 48, 256].flatMap((size) => [
    { file: `Square44x44Logo.targetsize-${size}.png`, size },
    { file: `Square44x44Logo.targetsize-${size}_altform-unplated.png`, size },
  ]),
  ...[1, 2, 4].map((k) => ({ file: `StoreLogo.scale-${k * 100}.png`, size: 50 * k })),
];

/** package.json's x.y.z as an MSIX version. The Store reserves the fourth number, and wants it 0. */
export function msixVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || match.slice(1).some((part) => Number(part) > 65535)) {
    throw new Error(`package.json version "${version}" cannot be an MSIX version (x.y.z, each at most 65535).`);
  }
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

/** The manifest template with its placeholders filled. */
export function renderManifest(template, { version, displayName }) {
  const xml = (text) =>
    text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
  const filled = template
    .replaceAll("{{VERSION}}", xml(version))
    .replaceAll("{{DISPLAY_NAME}}", xml(displayName));
  const left = /\{\{(\w+)\}\}/.exec(filled);
  if (left) throw new Error(`The manifest template has no value for {{${left[1]}}}.`);
  return filled;
}

/**
 * A makepri config for one package, not a bundle.
 *
 * The config makepri writes splits each scale into its own resources.scale-N.pri
 * for resource packs, which only exist inside an .msixbundle. In a lone .msix
 * nothing loads them, so every image above 100% scale would be lost and
 * Windows would stretch the small ones. Dropping the packaging section keeps
 * every candidate in the one resources.pri.
 */
export function singlePackage(priconfig) {
  return priconfig.replace(/\s*<packaging>[\s\S]*?<\/packaging>/, "");
}

const SDK_ROOTS = [
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin",
  "C:\\Program Files\\Windows Kits\\10\\bin",
];

/** A Windows SDK tool, from the newest installed SDK that has it. */
export function sdkTool(name, roots = SDK_ROOTS) {
  const numeric = (v) => v.split(".").map(Number);
  const newerFirst = (a, b) => {
    const [x, y] = [numeric(a), numeric(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    }
    return 0;
  };
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).filter((v) => /^\d+(\.\d+)+$/.test(v)).sort(newerFirst);
    for (const version of versions) {
      const tool = join(root, version, "x64", name);
      if (existsSync(tool)) return tool;
    }
  }
  throw new Error(`${name} was not found in the Windows SDK (looked in ${roots.join(", ")}). Install the Windows SDK.`);
}

// --- the build -------------------------------------------------------------

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed${result.status === null ? "" : ` (exit ${result.status})`}.`);
  }
}

/** Scale the app icon to every asset, with PowerShell's System.Drawing. */
function writeAssets(icon, folder, work) {
  mkdirSync(folder, { recursive: true });
  const list = join(work, "assets.json");
  writeFileSync(list, JSON.stringify(ASSETS.map((a) => ({ path: join(folder, a.file), size: a.size }))));
  const script = join(work, "assets.ps1");
  writeFileSync(
    script,
    [
      "param([string]$Icon, [string]$List)",
      "Add-Type -AssemblyName System.Drawing",
      "$source = [System.Drawing.Image]::FromFile($Icon)",
      "foreach ($asset in (Get-Content -Raw $List | ConvertFrom-Json)) {",
      "  $bitmap = New-Object System.Drawing.Bitmap $asset.size, $asset.size",
      "  $g = [System.Drawing.Graphics]::FromImage($bitmap)",
      "  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
      "  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality",
      "  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality",
      "  $g.DrawImage($source, 0, 0, $asset.size, $asset.size)",
      "  $g.Dispose()",
      "  $bitmap.Save($asset.path, [System.Drawing.Imaging.ImageFormat]::Png)",
      "  $bitmap.Dispose()",
      "}",
      "$source.Dispose()",
    ].join("\r\n"),
  );
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Icon", icon, "-List", list]);
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const packageVersion = msixVersion(version);

  if (!process.argv.includes("--no-build")) {
    // The frontend flag and the Cargo feature together: the frontend stops
    // offering updates, and the updater plugin is not compiled in.
    run("npx", ["tauri", "build", "--no-bundle", "--features", "store"], {
      cwd: root,
      env: { ...process.env, VITE_UPTIME_STORE: "microsoft" },
      shell: process.platform === "win32",
    });
  }

  const exe = join(root, "src-tauri", "target", "release", "uptime.exe");
  if (!existsSync(exe)) throw new Error(`${exe} is missing. Build it first, or drop --no-build.`);

  const work = join(root, "src-tauri", "target", "msix");
  const layout = join(work, "layout");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(layout, { recursive: true });

  copyFileSync(exe, join(layout, "uptime.exe"));
  writeAssets(join(root, "src-tauri", "icons", "icon.png"), join(layout, "Assets"), work);

  const template = readFileSync(join(root, "src-tauri", "msix", "AppxManifest.xml"), "utf8");
  const manifest = join(layout, "AppxManifest.xml");
  writeFileSync(manifest, renderManifest(template, { version: packageVersion, displayName: STORE_DISPLAY_NAME }));

  // resources.pri: the index that maps Assets\Square44x44Logo.png in the
  // manifest to the scaled and sized files beside it.
  const makepri = sdkTool("makepri.exe");
  const priconfig = join(work, "priconfig.xml");
  run(makepri, ["createconfig", "/cf", priconfig, "/dq", "en-US", "/o"]);
  writeFileSync(priconfig, singlePackage(readFileSync(priconfig, "utf8")));
  // Written beside the layout, not into it, so the index never indexes itself.
  const pri = join(work, "resources.pri");
  run(makepri, ["new", "/pr", layout, "/cf", priconfig, "/mn", manifest, "/of", pri, "/o"]);
  copyFileSync(pri, join(layout, "resources.pri"));

  const out = join(root, "release");
  mkdirSync(out, { recursive: true });
  const msix = join(out, `Uptime_${version}_x64.msix`);
  // makeappx checks the manifest against the schema and every file it names.
  run(sdkTool("makeappx.exe"), ["pack", "/d", layout, "/p", msix, "/o"]);

  console.log(`\nBuilt ${msix} (package version ${packageVersion}).`);
  console.log("Unsigned on purpose: upload it to Partner Center, which signs it after certification.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (err) {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
