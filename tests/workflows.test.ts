import { expect, test } from "bun:test";
import { parseDocument } from "yaml";
import { z } from "zod";

const stepSchema = z
  .object({
    uses: z.string().optional(),
    run: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const jobSchema = z
  .object({
    permissions: z.record(z.string(), z.string()).optional(),
    steps: z.array(stepSchema).optional(),
  })
  .passthrough();
const workflowSchema = z
  .object({
    on: z.record(z.string(), z.unknown()),
    permissions: z.record(z.string(), z.string()),
    jobs: z.record(z.string(), jobSchema),
  })
  .passthrough();
test("all workflows parse, pin external actions, and preserve credential boundaries", async () => {
  for (const name of ["validate", "sync", "pages"]) {
    const body = await Bun.file(`.github/workflows/${name}.yml`).text();
    const document = parseDocument(body);
    expect(document.errors).toHaveLength(0);
    const workflow = workflowSchema.parse(document.toJS());
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
        if (step.uses?.startsWith("actions/checkout@"))
          expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
    if (name === "sync") {
      expect(workflow.on).toHaveProperty("schedule");
      expect(workflow.on).toHaveProperty("workflow_dispatch");
      expect(workflow.jobs.sync?.permissions).toEqual({
        contents: "write",
        "pull-requests": "write",
      });
      expect(body).not.toContain("pull_request_target");
    }
    if (name === "validate") {
      expect(workflow.on).toHaveProperty("pull_request");
      expect(Object.values(workflow.jobs).every((job) => job.permissions === undefined)).toBe(true);
    }
  }
});
