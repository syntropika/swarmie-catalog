import { z } from "zod";
import type { Source } from "./schema.ts";
import { hash } from "./stable.ts";

export class SyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface Snapshot {
  source: Source;
  body: string;
}
export type SourceLoader = (repo: string, path: string, id: string) => Promise<Snapshot>;

export async function fetchText(
  url: string,
  request: Fetcher = fetch,
  limit = 32_000_000,
): Promise<string> {
  const signal = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await request(url, {
      signal,
      redirect: "error",
      headers: {
        "User-Agent": "swarmie-catalog",
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      },
    });
  } catch {
    throw new SyncError("source-network", `Source request failed: ${url}`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SyncError("source-http", `Source returned HTTP ${response.status}: ${url}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SyncError("source-empty", `Missing response body: ${url}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new SyncError("source-size", `Source exceeds size limit: ${url}`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("source-network", `Source body failed: ${url}`);
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  if (!body.trim()) throw new SyncError("source-empty", `Empty source: ${url}`);
  return body;
}

const commitSchema = z
  .array(
    z.object({
      sha: z.string().regex(/^[a-f0-9]{40}$/),
      commit: z.object({ committer: z.object({ date: z.iso.datetime() }) }),
    }),
  )
  .min(1);
export function githubLoader(request: Fetcher = fetch, githubToken?: string): SourceLoader {
  const metadataRequest: Fetcher = githubToken
    ? (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${githubToken}`);
        return request(url, { ...init, headers });
      }
    : request;
  return async (repo, path, id) => {
    const commits = commitSchema.parse(
      JSON.parse(
        await fetchText(
          `https://api.github.com/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`,
          metadataRequest,
        ),
      ),
    );
    const commit = commits[0];
    if (!commit) throw new SyncError("source-revision", `No revision: ${repo}/${path}`);
    const url = `https://raw.githubusercontent.com/${repo}/${commit.sha}/${path}`;
    const body = await fetchText(url, request);
    return {
      source: {
        id,
        url,
        revision: commit.sha,
        sha256: hash(body),
        modified_at: commit.commit.committer.date,
      },
      body,
    };
  };
}
