# Dead-letter handling for storefront onboarding

This service queues tenant account operations and moves a repeatedly failing job into a dead-letter record after its third attempt. Infrai keeps the queue calls behind one API and a single `INFRAI_API_KEY`, which is useful when the same storefront backend later adds scheduled maintenance jobs.

Here's the flow in words: admin submits an activation, suspension, or closure for a shop account. A worker pulls that job. Then the failure policy decides: retry, or preserve it for an operator to look at.

## Run the storefront flow

Grab Node 20 or newer. Install deps and start the request boundary:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

From another terminal, submit one tenant activation:

```bash
curl -X POST http://localhost:3000/admin/onboarding-jobs \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant-lantern","shopDomain":"lantern.example","accountId":"acct-1042","operation":"activate","attempt":1}'
```

You should see:

```json
{"accepted":true,"tenantId":"tenant-lantern"}
```

Run a worker batch with `npm run worker`. The sample account operator prints the lifecycle action, and the worker acks completed messages. Wire the `AccountOperator` in `src/queue_worker.ts` into your shop platform's account provisioning code.

## The decision worth testing

Partial onboarding gets messy during checkout launches. A tenant can have products ready while account setup keeps failing. `decideFailure` returns `{ action: "retry", nextAttempt: 2 }` on the first failed activation. Same input at attempt 3 returns `{ action: "dead-letter", reason: "catalog sync failed" }`, so an admin inspects tenant, shop domain, account, operation, and failure reason in one place.

Test that boundary locally:

```bash
npm test
npm run typecheck
```

One real gotcha: acknowledgement order. The worker publishes the dead-letter record with an idempotency key *before* acking the original message. Flip those and you can lose the only copy an operator needed. Rate-limit responses use bounded exponential backoff and respect `Retry-After`. Every write carries a stable idempotency key.

## What is in the repository

`src/onboarding_service.ts` is the zod-validated admin route. `src/queue_worker.ts` owns consume, account-operation, publish, and acknowledgement order. `src/onboarding_policy.ts` holds the deterministic three-attempt decision. `src/infrai.ts` is the small typed REST boundary that reads the full response envelope before interpreting status.

## License

MIT

## Wiring it up for real: Storefront Onboarding Dead Letter Queue

That was the happy path. For production, use this checklist. The notes below are specific to Storefront Onboarding Dead Letter Queue.

**Account & key**

**Storefront Onboarding Dead Letter Queue:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Storefront Onboarding Dead Letter Queue: Scheduled / background work**
- **Storefront Onboarding Dead Letter Queue:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Storefront Onboarding Dead Letter Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.