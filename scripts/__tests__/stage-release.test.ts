import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALLER_NAME, stage } from "../stage-release.mjs";

function fakeBuild(version: string, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "uptime-release-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  const bundle = join(root, "src-tauri", "target", "release", "bundle", "nsis");
  mkdirSync(bundle, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(bundle, name), body);
  return root;
}

describe("stage-release", () => {
  it("publishes the installer under one unversioned name, with a feed pointing at it", () => {
    const root = fakeBuild("0.2.0", {
      "Uptime_0.2.0_x64-setup.exe": "installer bytes",
      "Uptime_0.2.0_x64-setup.exe.sig": "c2lnbmF0dXJl\n",
    });
    stage({ root, repo: "YungDice/uptime-releases", now: new Date("2026-09-24T12:00:00.123Z") });

    expect(readFileSync(join(root, "release", INSTALLER_NAME), "utf8")).toBe("installer bytes");
    const feed = JSON.parse(readFileSync(join(root, "release", "latest.json"), "utf8"));
    const entry = {
      signature: "c2lnbmF0dXJl",
      url: "https://github.com/YungDice/uptime-releases/releases/download/v0.2.0/Uptime_Installer.exe",
    };
    expect(feed).toEqual({
      version: "0.2.0",
      notes: "Uptime 0.2.0",
      pub_date: "2026-09-24T12:00:00Z",
      platforms: { "windows-x86_64-nsis": entry, "windows-x86_64": entry },
    });
  });

  it("never picks up an installer left over from an older version", () => {
    const root = fakeBuild("0.2.0", {
      "Uptime_0.1.9_x64-setup.exe": "old",
      "Uptime_0.1.9_x64-setup.exe.sig": "old",
    });
    expect(() => stage({ root, repo: "a/b" })).toThrow(/No 0\.2\.0 installer/);
  });

  it("refuses an unsigned build, which installed copies would reject", () => {
    const root = fakeBuild("0.2.0", { "Uptime_0.2.0_x64-setup.exe": "installer bytes" });
    expect(() => stage({ root, repo: "a/b" })).toThrow(/not signed/);
  });
});
