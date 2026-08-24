import { describe, expect, it } from "vitest";
import { decideFailure, type OnboardingJob } from "../src/onboarding_policy.js";

const checkoutTenantJob: OnboardingJob = {
  tenantId: "tenant-lantern",
  shopDomain: "lantern.example",
  accountId: "acct-1042",
  operation: "activate",
  attempt: 1
};

describe("failed tenant onboarding", () => {
  it("retries the first failure and dead-letters the third", () => {
    expect(decideFailure(checkoutTenantJob, "catalog sync failed")).toEqual({
      action: "retry",
      nextAttempt: 2
    });
    expect(decideFailure({ ...checkoutTenantJob, attempt: 3 }, "catalog sync failed")).toEqual({
      action: "dead-letter",
      reason: "catalog sync failed"
    });
  });
});
