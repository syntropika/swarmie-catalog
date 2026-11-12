import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { hash } from "../src/stable.ts";

const root = ".artifacts/reports/cli-tests";
async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}
test("offline CLI replay is idempotent and a failed upstream retains stale records", async () => {
  const directory = `${root}/${crypto.randomUUID()}`;
  await mkdir(directory, { recursive: true });
  const output = `${directory}/catalog.json`;
  const common = ["--fixtures", "tests/fixtures", "--output", output, "--report-dir", directory];
  expect((await cli(["sync", ...common])).code).toBe(0);
  const first = hash(await Bun.file(output).text());
  expect((await cli(["sync", ...common])).code).toBe(0);
  expect(hash(await Bun.file(output).text())).toBe(first);
  expect((await cli(["validate", "--output", output])).code).toBe(0);
  await Bun.write(`${directory}/invalid.json`, "{}");
  expect((await cli(["sync", ...common, "--upstream", `${directory}/invalid.json`])).code).toBe(1);
  const failed = await Bun.file(output).json();
  expect(
    failed.providers.every(
      (provider: { state: string; claims: unknown[] }) =>
        provider.state === "stale" && provider.claims.length > 0,
    ),
  ).toBe(true);
  const health = await Bun.file(`${directory}/health.json`).json();
  expect(health.state).toBe("failed");
  expect((await cli(["sync", ...common])).code).toBe(0);
  expect(hash(await Bun.file(output).text())).toBe(first);
});
