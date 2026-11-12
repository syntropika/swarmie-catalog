import { z } from "zod";
import type { Adapter } from "../src/adapters/types.ts";
import { emptyRegistry, synchronize } from "../src/engine.ts";
import type { Snapshot, SourceLoader } from "../src/fetch.ts";
import { sourceSchema, upstreamSchema } from "../src/schema.ts";
import { hash } from "../src/stable.ts";

const snapshotSchema = z.object({ source: sourceSchema, body: z.string() }).strict();
export const now = "2026-11-12T00:00:00.000Z";
export const fixtureLoader: SourceLoader = async (_repo, _path, id) =>
  snapshotSchema.parse(await Bun.file(new URL(`./fixtures/${id}.json`, import.meta.url)).json());
export async function snapshot(id: string, body?: string): Promise<Snapshot> {
  const value = await fixtureLoader("", "", id);
  return body === undefined
    ? value
    : { ...value, body, source: { ...value.source, sha256: hash(body) } };
}
export async function upstream() {
  return upstreamSchema.parse(
    await Bun.file(new URL("./fixtures/upstream.json", import.meta.url)).json(),
  );
}
export async function initial(adapters: Adapter[]) {
  return synchronize({
    previous: emptyRegistry(),
    upstream: await upstream(),
    adapters,
    loader: fixtureLoader,
    aliases: {},
    now,
  });
}
