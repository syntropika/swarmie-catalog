import type { Snapshot, SourceLoader } from "../fetch.ts";
import type { ExtractedClaim } from "../schema.ts";
export interface Adapter {
  id: string;
  load: (loader: SourceLoader) => Promise<Snapshot[]>;
  parse: (sources: Snapshot[]) => ExtractedClaim[];
}
export function sourceBody(sources: Snapshot[], id: string): string {
  const source = sources.find((item) => item.source.id === id);
  if (!source) throw new Error(`Missing source: ${id}`);
  return source.body;
}
