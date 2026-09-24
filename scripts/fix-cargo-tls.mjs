// Fixes `cargo` failing to reach crates.io on Windows with
//
//   [60] SSL peer certificate or SSH remote key was not OK
//   (schannel: SEC_E_UNTRUSTED_ROOT ...)
//
// On Windows cargo checks certificates against the Windows certificate store,
// and that store is missing the root crates.io chains to - usually because
// automatic root updates are off or stale. Node ships its own copy of the
// Mozilla root list, so this script:
//
//   1. connects to crates.io trusting only that list;
//   2. if the chain checks out, writes the list to $CARGO_HOME/ca-roots.pem and
//      points cargo at it with `http.cainfo` in $CARGO_HOME/config.toml;
//   3. if it does not, something between this machine and crates.io is
//      re-signing the traffic (antivirus HTTPS scanning, a company proxy), and
//      the script names the issuer rather than trusting it for you.
//
// Only cargo's settings on this machine change; the repo does not. To undo,
// delete the `cainfo` line from $CARGO_HOME/config.toml.
//
//   npm run fix:cargo-tls

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const HOSTS = ["index.crates.io", "static.crates.io"];

/**
 * Returns config.toml with `http.cainfo` set to `caPath`, or null when the file
 * already sets a cainfo of its own - that was someone's deliberate choice, so
 * it is reported rather than overwritten.
 */
export function withCainfo(config, caPath) {
  // A TOML literal string: no escaping, so Windows backslashes survive as-is.
  const line = `cainfo = '${caPath}'`;
  const lines = config.split(/\r?\n/);
  const header = lines.findIndex((l) => /^\s*\[http\]\s*(#.*)?$/.test(l));
  if (header === -1) {
    if (/^\s*http\.cainfo\s*=/m.test(config)) return null;
    const body = config.replace(/\s*$/, "");
    return `${body}${body ? "\n\n" : ""}[http]\n${line}\n`;
  }
  let end = lines.findIndex((l, i) => i > header && /^\s*\[/.test(l));
  if (end === -1) end = lines.length;
  if (lines.slice(header + 1, end).some((l) => /^\s*cainfo\s*=/.test(l))) return null;
  lines.splice(header + 1, 0, line);
  return lines.join("\n");
}

/** Connects trusting only Node's bundled roots, and reports what it saw. */
function probe(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host,
      port: 443,
      servername: host,
      ca: tls.rootCertificates,
      rejectUnauthorized: false,
    });
    socket.setTimeout(15000, () => socket.destroy(new Error("timed out")));
    socket.once("secureConnect", () => {
      let top = socket.getPeerCertificate(true);
      while (top.issuerCertificate && top.issuerCertificate !== top) top = top.issuerCertificate;
      resolve({
        host,
        authorized: socket.authorized,
        error: socket.authorizationError,
        root: top.issuer?.O || top.issuer?.CN || "unknown",
      });
      socket.end();
    });
    socket.once("error", (err) => resolve({ host, failed: err.message }));
  });
}

async function main() {
  const results = await Promise.all(HOSTS.map(probe));

  const failed = results.filter((r) => r.failed);
  if (failed.length) {
    for (const r of failed) console.error(`Could not reach ${r.host}: ${r.failed}`);
    console.error("\nCheck the connection (or VPN/proxy) and run this again.");
    process.exit(1);
  }

  const intercepted = results.filter((r) => !r.authorized);
  if (intercepted.length) {
    for (const r of intercepted) {
      console.error(`${r.host} is being re-signed by "${r.root}" (${r.error}).`);
    }
    console.error(
      [
        "",
        "Something on this machine or network is intercepting HTTPS - most often",
        "antivirus \"HTTPS scanning\"/\"web shield\", or a company proxy. Either:",
        "  - turn that scanning off (or exclude cargo.exe / *.crates.io), or",
        "  - export that issuer's root certificate as Base-64 .cer, and run",
        "      [Environment]::SetEnvironmentVariable('CARGO_HTTP_CAINFO', '<path to .cer>', 'User')",
        "    then open a new terminal.",
        "Nothing was changed.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
  mkdirSync(cargoHome, { recursive: true });
  const caPath = join(cargoHome, "ca-roots.pem");
  writeFileSync(caPath, tls.rootCertificates.join("\n") + "\n");

  const configPath = join(cargoHome, "config.toml");
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const next = withCainfo(current, caPath);
  if (next === null) {
    console.log(`${configPath} already sets http.cainfo; left it alone.`);
    console.log(`If builds still fail, point it at ${caPath} instead.`);
    return;
  }
  writeFileSync(configPath, next);
  console.log(`crates.io checks out against Mozilla's roots (${results[0].root}).`);
  console.log(`Wrote ${caPath}`);
  console.log(`Set http.cainfo in ${configPath}`);
  console.log("\nRun `npm run desktop:build` again.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
