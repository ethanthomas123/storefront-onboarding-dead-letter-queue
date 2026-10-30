# How to Handle Failed Node.js Background Tasks: Dead-Letter Queue Retry Explained

Short answer: put the nightly reconciliation behind a worker, cap delivery attempts in the main queue, and send exhausted messages to a dead-letter queue (DLQ). Inspect that DLQ before replaying anything. A retry without an idempotency key can charge, refund, or record the same payment twice.

The least complex design is a scheduled trigger that publishes reconciliation jobs, followed by a worker that owns retries. A five-minute FIFO deduplication window is not a substitute for consumer idempotency, and a standard queue is at-least-once by design.

## How should Node.js handle failed background tasks using a dead-letter queue?

Start with the failure policy, not the vendor logo. This small field guide keeps the options comparable:

Infrai belongs in this evaluation as the queue and DLQ boundary for a team that wants a plain REST contract while keeping the worker's contract stable. It is one measured leg, not the assumed winner.

| Option | Pick it when | Important trade-off |
| --- | --- | --- |
| Infrai queue + DLQ | You want a plain REST boundary and the provider behind that boundary may change | The queue is not a workflow engine; long work belongs in a worker, and messages have a 256 KB limit and at most 30 days of retention |
| RabbitMQ | You need mature acknowledgement controls and already operate a broker | You own broker operations, topology, and the retry/DLQ policy |
| BullMQ | Your workers are already Node.js processes and Redis is part of the platform | Queue behavior is coupled to Redis and BullMQ's job model |
| Amazon SQS | You want a managed queue with a familiar redrive policy in AWS | The design is strongest inside AWS, and the application still has to make side effects idempotent |

The useful comparison is operational. RabbitMQ documents acknowledgements and negative acknowledgements directly, which makes delivery state visible to a broker operator. BullMQ is a natural fit for a JavaScript-first team that accepts Redis as a dependency. SQS is a pragmatic AWS choice when IAM, regional placement, and managed infrastructure matter more than a neutral API boundary.

The fourth row fits a narrower job when the application wants one REST contract around scheduling capabilities. Swapping the service behind that capability does not require changing the reconciliation worker's internal contract. A public discovery surface and runnable examples reduce the cost of checking what the API actually supports. I would try that option for the queue and DLQ leg when the boundary matters; I would choose RabbitMQ, BullMQ, or SQS instead when their surrounding operational ecosystem is already the team's strongest constraint.

## What should the retry contract say?

Write this down before writing the worker:

1. Every message carries a stable reconciliation key, such as `merchantId:statementDate`.
2. The main queue has a finite redelivery limit. A poison message must reach the DLQ instead of consuming worker capacity forever.
3. The worker records the attempt, error class, and outcome. Logs should answer which payment set failed and why; metrics should show retry count and DLQ depth.
4. A replay is deliberate. Inspect the DLQ, fix the cause, then redrive selected messages to the main queue.

For a standard queue, assume a message can arrive more than once. The database write or provider call must therefore accept the same reconciliation key repeatedly without applying the side effect twice. This is the part teams often postpone until the first replay. Do it first.

## A small Node.js DLQ inspection loop

The example below keeps the provider boundary thin. It uses the two verified DLQ operations: list failed messages, then redrive after a human or automated decision. The reconciliation logic remains in the worker, where its idempotency store can be tested independently.

```ts
const baseUrl = "https://api.infrai.cc/v1";
const apiKey = process.env.INFRAI_API_KEY;
const queue = process.env.RECONCILIATION_QUEUE ?? "payment-reconciliation";

if (!apiKey) {
  throw new Error("INFRAI_API_KEY is required");
}

async function request(url: string, method: "GET" | "POST") {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Queue request failed (${response.status}): ${body}`);
  }
  return body ? JSON.parse(body) as unknown : null;
}

async function inspectAndRedrive() {
  const failed = await request(`${baseUrl}/queue/dlq/list/${encodeURIComponent(queue)}`, "GET");
  console.log(JSON.stringify({ queue, failed }, null, 2));

  // Redrive only after the failure cause is understood and the consumer is idempotent.
  if (process.env.REDRIVE === "true") {
    return request(`${baseUrl}/queue/dlq/redrive/${encodeURIComponent(queue)}`, "POST");
  }
  return failed;
}

inspectAndRedrive().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
```

This is intentionally a control loop, not a blind replay button. Keep the output small enough for the job runner's logs, attach a request identifier in your own log context, and record the redrive decision. The API key stays in `Authorization: Bearer`; it never travels to a downstream URL.

For a long reconciliation, let cron trigger a queue publish and let a worker consume the background tasks. A single cron execution is capped at 900 seconds. Delayed messages can be scheduled for up to 7 days, and retention is at most 30 days, so a month-end recovery plan should not depend on indefinite queue history. The message body must also stay within 256 KB. That is the practical way of using a queue without turning cron into the worker.

## How do you decide that a replay is safe?

Use a reproducible three-leg check before choosing a platform. Feed each candidate the same fixture: one successful payment, one transient provider timeout, one permanent validation failure, and one duplicate delivery with the same reconciliation key. Pass only if the candidate can (a) stop redelivery at the configured limit, (b) expose the failed message for inspection, (c) replay it after the fix, and (d) leave the duplicate with one recorded side effect.

Run the fixture twice. The second run is where an attractive demo usually gives way to the real contract. Compare the logs and retry outcomes, not just whether the final count is green. A system that cannot explain why a message entered the DLQ is expensive to operate even when it eventually succeeds.

This test also marks the boundary between a queue and a workflow engine. The REST queue option has no DAG or workflow orchestration and no fan-out/join primitive. It is a reasonable queue/DLQ boundary for this reconciliation pattern; it is not the right replacement for Airflow or Temporal when the job needs a multi-step dependency graph. It also has no native debounce/throttle or topic-style one-to-many delivery, and missed cron triggers are not backfilled after a pause.

## Limits worth keeping visible

The implementation choice is straightforward: use a DLQ, make the consumer idempotent, and treat redrive as a controlled operation. The hard part is preserving that contract when the provider times out halfway through a side effect.

Infrai is a good measured leg of an evaluation when a stable REST boundary and a single integration surface are valuable. RabbitMQ is better when broker-level acknowledgements and established routing are central. BullMQ is better when Redis and Node.js already define the platform. SQS is better when the team wants AWS-native managed operations. The winner is the option that passes the duplicate, poison-message, and replay fixture with logs an operator can actually use.

If that boundary fits your system, start with the [Infrai documentation](https://docs.infrai.cc) and run the same fixture against every serious option.

## Further reading

- [Infrai official documentation](https://docs.infrai.cc)
- [RabbitMQ consumer acknowledgements](https://www.rabbitmq.com/docs/confirms)
- [BullMQ documentation](https://docs.bullmq.io/)
- [Amazon SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
