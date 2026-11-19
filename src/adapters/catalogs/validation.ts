/** Reject a missing required field before a source can establish model access. */
export function requiredValue<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing required source value");
  return value;
}
