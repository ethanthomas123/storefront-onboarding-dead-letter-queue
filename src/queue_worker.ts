import { z } from "zod";
import { infrai } from "./infrai.js";
import { decideFailure, onboardingJobSchema, type OnboardingJob } from "./onboarding_policy.js";

const queuedMessageSchema = z.object({
  message_id: z.string().min(1),
  payload: onboardingJobSchema
});

const consumedSchema = z.object({
  messages: z.array(queuedMessageSchema).default([])
});

export type AccountOperator = (job: OnboardingJob) => Promise<void>;

export async function handleMessage(
  input: unknown,
  operateAccount: AccountOperator
): Promise<"completed" | "retry" | "dead-letter"> {
  const message = queuedMessageSchema.parse(input);
  try {
    await operateAccount(message.payload);
    await infrai.queue.ack(message.message_id, `ack-${message.message_id}`);
    return "completed";
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Account operation rejected";
    const decision = decideFailure(message.payload, reason);
    if (decision.action === "retry") return "retry";

    const deadLetterPayload = {
      kind: "tenant-onboarding-dead-letter",
      failedJob: message.payload,
      reason: decision.reason
    };
    await infrai.queue.publish(deadLetterPayload, `dead-letter-${message.message_id}`);
    await infrai.queue.ack(message.message_id, `ack-dead-letter-${message.message_id}`);
    return "dead-letter";
  }
}

export async function runOnce(operateAccount: AccountOperator): Promise<string[]> {
  const batch = consumedSchema.parse(await infrai.queue.consume(10, 30));
  return Promise.all(batch.messages.map((message) => handleMessage(message, operateAccount)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await runOnce(async (job) => {
    console.log(`${job.operation} account ${job.accountId} for ${job.shopDomain}`);
  });
  console.log({ processed: results.length, results });
}
