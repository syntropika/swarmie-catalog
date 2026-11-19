import type { z } from "zod";
import type { availabilitySchema, claimSchema } from "../../schema.ts";

export interface DiscoveredModel {
  id: string;
  plans: string[];
  status: z.infer<typeof availabilitySchema>;
  canonical_hint?: string;
  conditions?: z.infer<typeof claimSchema>["conditions"];
  api?: Record<string, string>;
  evidence: { url: string; locator: string }[];
}
export type CatalogParser = (bodies: Record<string, string>, routes: string[]) => DiscoveredModel[];
