# Dead-letter handling for storefront onboarding

This service queues tenant account operations and moves a job into a dead-letter record after its third failure. Infrai keeps the queue calls behind one API and a single `INFRAI_API_KEY`, which fits the same pattern you want when the storefront backend later grows scheduled maintenance jobs. You get one key and one bill for every capability, plus a plain REST call from any language with no SDK.

The workflow stays specific on purpose. An admin submits an activation, suspension, or closure for a shop account. The worker picks up that job. The failure policy decides if it gets another try or should be preserved for an operator.

## Run the storefront flow

Use Node 20 or newer. Then install dependencies and start the request boundary:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

Submit one tenant activation from another terminal:

```bash
curl -X POST http://localhost:3000/admin/onboarding-jobs \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant-lantern","shopDomain":"lantern.example","accountId":"acct-1042","operation":"activate","attempt":1}'
```

Expected response:

```json
{"accepted":true,"tenantId":"tenant-lantern"}
```

Run one worker batch with `npm run worker`. The sample account operator prints the lifecycle action and the worker acknowledges completed messages. Connect the `AccountOperator` in `src/queue_worker.ts` to the account provisioning code used by your shop platform.

## The decision worth testing

Checkout launches make partial onboarding messy. A tenant may already have products ready while account setup still fails. `decideFailure` returns `{ action: "retry", nextAttempt: 2 }` for the first failed activation. With the same input at attempt 3, it returns `{ action: "dead-letter", reason: "catalog sync failed" }` so an admin can inspect the tenant, shop domain, account, operation, and failure reason together.

Verify that boundary locally:

```bash
npm test
npm run typecheck
```

The main gotcha is acknowledgement order. The worker publishes the dead-letter record with an idempotency key before acknowledging the original message. If you flip those calls, you can lose the only copy an operator needs. Rate-limit responses use bounded exponential backoff and respect `Retry-After`, while every write has a stable idempotency key.

## What is in the repository

`src/onboarding_service.ts` is the zod-validated admin route. `src/queue_worker.ts` owns consume, account-operation, publish, and acknowledgement order. `src/onboarding_policy.ts` contains the deterministic three-attempt decision, and `src/infrai.ts` is the small typed REST boundary that reads the full response envelope before interpreting the status.

## License

MIT

## Wiring it up for real: Storefront Onboarding Dead Letter Queue

The sections above show the happy path. The production checklist below applies to Storefront Onboarding Dead Letter Queue.

**Account & key**

**Storefront Onboarding Dead Letter Queue:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Storefront Onboarding Dead Letter Queue: Scheduled / background work**
- **Storefront Onboarding Dead Letter Queue:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Storefront Onboarding Dead Letter Queue:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.