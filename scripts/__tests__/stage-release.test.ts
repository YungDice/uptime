import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLER_NAME, MSI_NAME, stage } from "../stage-release.mjs";

type Files = Record<string, string>;

function fakeBuild(version: string, bundles: { nsis?: Files; msi?: Files }) {
  const root = mkdtempSync(join(tmpdir(), "uptime-release-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  for (const [kind, files] of Object.entries(bundles)) {
    const folder = join(root, "src-tauri", "target", "release", "bundle", kind);
    mkdirSync(folder, { recursive: true });
    for (const [name, body] of Object.entries(files ?? {})) writeFileSync(join(folder, name), body);
  }
  return root;
}

const SIGNED = {
  nsis: {
    "Uptime_0.2.0_x64-setup.exe": "exe bytes",
    "Uptime_0.2.0_x64-setup.exe.sig": "ZXhlIHNpZw==\n",
  },
  msi: {
    "Uptime_0.2.0_x64_en-US.msi": "msi bytes",
    "Uptime_0.2.0_x64_en-US.msi.sig": "bXNpIHNpZw==\n",
  },
};

describe("stage-release", () => {
  it("publishes both installers under unversioned names, with a feed entry for each", () => {
    const root = fakeBuild("0.2.0", SIGNED);
    stage({ root, repo: "YungDice/uptime", now: new Date("2026-09-24T12:00:00.123Z") });

    expect(readFileSync(join(root, "release", INSTALLER_NAME), "utf8")).toBe("exe bytes");
    expect(readFileSync(join(root, "release", MSI_NAME), "utf8")).toBe("msi bytes");

    const feed = JSON.parse(readFileSync(join(root, "release", "latest.json"), "utf8"));
    const nsis = {
      signature: "ZXhlIHNpZw==",
      url: "https://github.com/YungDice/uptime/releases/download/v0.2.0/Uptime_Installer.exe",
    };
    const msi = {
      signature: "bXNpIHNpZw==",
      url: "https://github.com/YungDice/uptime/releases/download/v0.2.0/Uptime_Installer.msi",
    };
    expect(feed).toEqual({
      version: "0.2.0",
      notes: "Uptime 0.2.0",
      pub_date: "2026-09-24T12:00:00Z",
      // An MSI install updates from the MSI and an NSIS install from the .exe;
      // anything that does not say which gets the .exe.
      platforms: { "windows-x86_64-nsis": nsis, "windows-x86_64-msi": msi, "windows-x86_64": nsis },
    });
  });

  it("never picks up an installer left over from an older version", () => {
    const root = fakeBuild("0.2.0", {
      nsis: { "Uptime_0.1.9_x64-setup.exe": "old", "Uptime_0.1.9_x64-setup.exe.sig": "old" },
      msi: SIGNED.msi,
    });
    expect(() => stage({ root, repo: "a/b" })).toThrow(/No 0\.2\.0 NSIS installer/);
  });

  it("refuses an unsigned build, which installed copies would reject", () => {
    const root = fakeBuild("0.2.0", {
      nsis: SIGNED.nsis,
      msi: { "Uptime_0.2.0_x64_en-US.msi": "msi bytes" },
    });
    expect(() => stage({ root, repo: "a/b" })).toThrow(/not signed/);
  });

  it("refuses a build without the MSI, so a release never goes out missing one", () => {
    const root = fakeBuild("0.2.0", { nsis: SIGNED.nsis });
    expect(() => stage({ root, repo: "a/b" })).toThrow(/No MSI bundle/);
  });
});
