import { describe, expect, it } from "vitest";
import { withCainfo } from "../fix-cargo-tls.mjs";

const PEM = "C:\\Users\\me\\.cargo\\ca-roots.pem";

describe("fix-cargo-tls", () => {
  it("creates the setting in an empty config", () => {
    expect(withCainfo("", PEM)).toBe(`[http]\ncainfo = '${PEM}'\n`);
  });

  it("appends an [http] table after existing settings", () => {
    expect(withCainfo("[net]\ngit-fetch-with-cli = true\n", PEM)).toBe(
      `[net]\ngit-fetch-with-cli = true\n\n[http]\ncainfo = '${PEM}'\n`,
    );
  });

  it("adds to an existing [http] table rather than opening a second one", () => {
    const next = withCainfo("[http]\ncheck-revoke = false\n\n[net]\nretry = 3\n", PEM);
    expect(next).toBe(`[http]\ncainfo = '${PEM}'\ncheck-revoke = false\n\n[net]\nretry = 3\n`);
  });

  it("leaves a cainfo someone already set alone", () => {
    expect(withCainfo("[http]\ncainfo = 'D:/corp.pem'\n", PEM)).toBeNull();
    expect(withCainfo("http.cainfo = 'D:/corp.pem'\n", PEM)).toBeNull();
  });

  it("does not mistake a cainfo in another table for its own", () => {
    const next = withCainfo("[http]\nproxy = 'x'\n[registries.corp]\ncainfo = 'y'\n", PEM);
    expect(next).toBe(`[http]\ncainfo = '${PEM}'\nproxy = 'x'\n[registries.corp]\ncainfo = 'y'\n`);
  });
});
