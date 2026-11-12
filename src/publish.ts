import { z } from "zod";
import { validateRegistry } from "./engine.ts";
import type { Fetcher } from "./fetch.ts";

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const refSchema = z.object({ object: z.object({ sha }) });
const gitCommitSchema = z.object({ tree: z.object({ sha }) });
const objectSchema = z.object({ sha });
const pullSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
  head: z.object({ ref: z.string() }),
});
const branch = "feat/catalog-sync";
const message = "chore(catalog): synchronize subscription declarations";

/** Update one automation branch through fast-forward refs. Never merge its pull request. */
export async function publish(options: {
  repository: string;
  baseBranch: string;
  token: string;
  catalog: string;
  report: string;
  request?: Fetcher;
}): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository))
    throw new Error("Invalid repository");
  if (!options.baseBranch || options.baseBranch === branch || !options.token)
    throw new Error("Invalid publication configuration");
  validateRegistry(JSON.parse(options.catalog));
  const request = options.request ?? fetch;
  const prefix = `https://api.github.com/repos/${options.repository}`;
  async function api(
    route: string,
    method = "GET",
    body?: unknown,
    allowMissing = false,
    raw = false,
  ): Promise<unknown> {
    const response = await request(`${prefix}${route}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allowMissing && response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub publication failed: HTTP ${response.status}`);
    }
    return raw ? response.text() : response.json();
  }
  const baseRef = `/git/ref/heads/${encodeURIComponent(options.baseBranch)}`;
  const base = refSchema.parse(await api(baseRef)).object.sha;
  const owner = options.repository.split("/")[0];
  const pulls = z
    .array(pullSchema)
    .parse(
      await api(
        `/pulls?state=open&base=${encodeURIComponent(options.baseBranch)}&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`,
      ),
    );
  if (pulls.length > 1) throw new Error("Multiple automation pull requests exist");
  const existing = pulls[0];
  const baseFile = await api(
    `/contents/data/catalog.json?ref=${base}`,
    "GET",
    undefined,
    true,
    true,
  );
  if (baseFile === options.catalog) {
    if (existing) await api(`/pulls/${existing.number}`, "PATCH", { state: "closed" });
    return null;
  }
  const headResult = await api(
    `/git/ref/heads/${encodeURIComponent(branch)}`,
    "GET",
    undefined,
    true,
  );
  const head = headResult === null ? null : refSchema.parse(headResult).object.sha;
  const currentContent =
    head === null
      ? null
      : await api(`/contents/data/catalog.json?ref=${head}`, "GET", undefined, true, true);
  if (currentContent !== options.catalog || !existing) {
    const baseTree = gitCommitSchema.parse(await api(`/git/commits/${base}`)).tree.sha;
    const blob = objectSchema.parse(
      await api("/git/blobs", "POST", { content: options.catalog, encoding: "utf-8" }),
    ).sha;
    const tree = objectSchema.parse(
      await api("/git/trees", "POST", {
        base_tree: baseTree,
        tree: [{ path: "data/catalog.json", mode: "100644", type: "blob", sha: blob }],
      }),
    ).sha;
    const parents = head !== null && head !== base ? [head, base] : [base];
    const commit = objectSchema.parse(
      await api("/git/commits", "POST", { message, tree, parents }),
    ).sha;
    // Refuse a race with a default-branch update. The next scheduled run can retry.
    if (refSchema.parse(await api(baseRef)).object.sha !== base)
      throw new Error("Default branch changed during publication");
    if (head === null) await api("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: commit });
    else
      await api(`/git/refs/heads/${encodeURIComponent(branch)}`, "PATCH", {
        sha: commit,
        force: false,
      });
  }
  const body = { title: message, body: options.report };
  const result = existing
    ? await api(`/pulls/${existing.number}`, "PATCH", body)
    : await api("/pulls", "POST", { ...body, head: branch, base: options.baseBranch });
  return pullSchema.parse(result).html_url;
}
if (import.meta.main) {
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    const baseBranch = process.env.CATALOG_BASE_BRANCH;
    const token = process.env.GITHUB_TOKEN;
    if (!repository || !baseBranch || !token)
      throw new Error("Missing GitHub publication configuration");
    const url = await publish({
      repository,
      baseBranch,
      token,
      catalog: await Bun.file("data/catalog.json").text(),
      report: await Bun.file(".artifacts/reports/sync/report.md").text(),
    });
    console.log(url ?? "No catalog changes to publish.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Publication failed");
    process.exitCode = 1;
  }
}
