import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSETS,
  STORE_DISPLAY_NAME,
  msixVersion,
  renderManifest,
  sdkTool,
  singlePackage,
} from "../build-msix.mjs";

const TEMPLATE = readFileSync(join(__dirname, "../../src-tauri/msix/AppxManifest.xml"), "utf8");

describe("the Store package's version", () => {
  it("is package.json's, with the fourth number the Store keeps at zero", () => {
    expect(msixVersion("0.1.8")).toBe("0.1.8.0");
    expect(msixVersion("2.10.300")).toBe("2.10.300.0");
  });

  it("refuses anything MSIX cannot carry", () => {
    expect(() => msixVersion("0.1.8-beta.1")).toThrow();
    expect(() => msixVersion("1.70000.0")).toThrow();
  });
});

describe("the manifest", () => {
  const xml = renderManifest(TEMPLATE, { version: "0.1.8.0", displayName: STORE_DISPLAY_NAME });

  it("carries the identity Partner Center assigned", () => {
    expect(xml).toContain('Name="DiceEntertainment.UptimeStreakStopwatch"');
    expect(xml).toContain('Publisher="CN=56A36FC1-BB7D-4C5C-B792-EBDCC2907AB3"');
    expect(xml).toContain("<PublisherDisplayName>Dice Entertainment</PublisherDisplayName>");
    expect(xml).toContain('Version="0.1.8.0"');
  });

  it("is left with nothing unfilled", () => {
    expect(xml).not.toMatch(/\{\{\w+\}\}/);
  });

  it("escapes a display name for XML", () => {
    expect(renderManifest(TEMPLATE, { version: "1.0.0.0", displayName: "A & B" })).toContain(
      "<DisplayName>A &amp; B</DisplayName>",
    );
  });

  it("registers the scheme invite links use, passing the link as the only argument", () => {
    expect(xml).toContain('<uap3:Protocol Name="uptime" Parameters="&quot;%1&quot;">');
  });

  it("names only images the build generates", () => {
    const named = [...xml.matchAll(/Assets\\([A-Za-z0-9]+)\.png/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const base of named) {
      expect(ASSETS.some((a) => a.file.startsWith(`${base}.`)), base).toBe(true);
    }
  });
});

describe("the Windows SDK tools", () => {
  it("are taken from the newest SDK that has them", () => {
    const root = mkdtempSync(join(tmpdir(), "uptime-sdk-"));
    for (const version of ["10.0.17134.0", "10.0.26100.0", "10.0.22621.0"]) {
      mkdirSync(join(root, version, "x64"), { recursive: true });
      writeFileSync(join(root, version, "x64", "makeappx.exe"), "");
    }
    // A newer SDK folder without the tool is passed over, not picked.
    mkdirSync(join(root, "10.0.99999.0", "x64"), { recursive: true });
    expect(sdkTool("makeappx.exe", [root])).toBe(join(root, "10.0.26100.0", "x64", "makeappx.exe"));
  });

  it("says where it looked when there is none", () => {
    const root = mkdtempSync(join(tmpdir(), "uptime-sdk-"));
    expect(() => sdkTool("makeappx.exe", [root])).toThrow(/Windows SDK/);
  });
});

describe("the resource index config", () => {
  // The shape makepri createconfig writes (10.0.26100), trimmed.
  const generated = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<resources targetOsVersion="10.0.0" majorVersion="1">',
    "\t<packaging>",
    '\t\t<autoResourcePackage qualifier="Language"/>',
    '\t\t<autoResourcePackage qualifier="Scale"/>',
    "\t</packaging>",
    '\t<index root="\\" startIndexAt="\\">',
    '\t\t<indexer-config type="folder" foldernameAsQualifier="true" filenameAsQualifier="true" qualifierDelimiter="."/>',
    "\t</index>",
    "</resources>",
  ].join("\r\n");

  it("keeps every scale in the one index a lone package loads", () => {
    const config = singlePackage(generated);
    expect(config).not.toContain("<packaging>");
    expect(config).not.toContain("autoResourcePackage");
  });

  it("leaves the rest of the config as it was", () => {
    expect(singlePackage(generated)).toContain('<indexer-config type="folder"');
  });
});
