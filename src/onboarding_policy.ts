import { z } from "zod";

export const onboardingJobSchema = z.object({
  tenantId: z.string().min(1),
  shopDomain: z.string().min(1),
  accountId: z.string().min(1),
  operation: z.enum(["activate", "suspend", "close"]),
  attempt: z.number().int().min(1)
});

export type OnboardingJob = z.infer<typeof onboardingJobSchema>;

export type FailureDecision =
  | { action: "retry"; nextAttempt: number }
  | { action: "dead-letter"; reason: string };

export function decideFailure(job: OnboardingJob, reason: string): FailureDecision {
  if (job.attempt < 3) return { action: "retry", nextAttempt: job.attempt + 1 };
  return { action: "dead-letter", reason };
}
