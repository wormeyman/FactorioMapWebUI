import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const svcDir = join(here, "..");
const fixtures = join(here, "../../../test/fixtures");
const IMAGE = "fmw-preview-test:latest";

function isPng(buf) {
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

test(
  "image builds and renders a valid PNG for Nauvis and a non-Nauvis planet",
  { timeout: 600000 },
  () => {
    execFileSync("docker", ["build", "--platform", "linux/amd64", "-t", IMAGE, svcDir], {
      stdio: "inherit",
    });

    for (const planet of ["nauvis", "vulcanus"]) {
      const out = execFileSync(
        "docker",
        [
          "run",
          "--rm",
          "--platform",
          "linux/amd64",
          "-v",
          `${fixtures}:/in:ro`,
          "--entrypoint",
          "/opt/factorio/bin/x64/factorio",
          IMAGE,
          "--generate-map-preview",
          "/dev/stdout",
          "--map-gen-settings",
          "/in/map-gen-settings.default-nauvis.dump.json",
          "--map-preview-planet",
          planet,
          "--map-gen-seed",
          "123456",
          "--map-preview-size",
          "256",
        ],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      assert.ok(isPng(out), `expected a PNG for ${planet}`);
    }
  },
);
