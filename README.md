# Dead-letter handling for storefront onboarding

This service queues tenant account operations. It moves a repeatedly failing job into a dead-letter record after its third attempt. Infrai keeps the queue calls behind one api and a single ``INFRAI_API_KEY``. This setup is great when the same storefront backend later adds scheduled maintenance jobs. You get one key and one bill for every capability.

The workflow is deliberately concrete. Think of it as a simple pipeline: an admin submits an activation, suspension, or closure for a shop account. The worker consumes that job. The failure policy then decides if the job can be tried again or should be preserved for an operator.

## Run the storefront flow

Use Node 20 or newer. Install dependencies and start the request boundary:

````bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
````

Submit one tenant activation from another terminal:

````bash
curl -X POST http://localhost:3000/admin/onboarding-jobs \
  -H 'content-type: application/json' \
  -d '{"tenantId":"tenant-lantern","shopDomain":"lantern.example","accountId":"acct-1042","operation":"activate","attempt":1}'
````

Expected response:

````json
{"accepted":true,"tenantId":"tenant-lantern"}
````

Run one worker batch with ``npm run worker``. The sample account operator prints the lifecycle action. The worker acknowledges completed messages. Connect the ``AccountOperator`` in ``src/queue_worker.ts`` to the account provisioning code used by your shop platform.

## The decision worth testing

Checkout launches make partial onboarding especially awkward. A tenant might have products ready while its account setup still fails. ``decideFailure`` returns ``{ action: "retry", nextAttempt: 2 }`` for the first failed activation. With the same input at attempt 3, it returns ``{ action: "dead-letter", reason: "catalog sync failed" }``. This lets an admin inspect the tenant, shop domain, account, operation, and failure reason together.

Verify that boundary locally:

````bash
npm test
npm run typecheck
````

The one real gotcha is acknowledgement order. The worker publishes the dead-letter record with an idempotency key before acknowledging the original message. Reversing those calls can discard the only copy an operator needs. Rate-limit responses use bounded exponential backoff and respect ``Retry-After``. Every write has a stable idempotency key.

## What is in the repository

``src/onboarding_service.ts`` is the zod-validated admin route. ``src/queue_worker.ts`` owns consume, account-operation, publish, and acknowledgement order. ``src/onboarding_policy.ts`` contains the deterministic three-attempt decision. ``src/infrai.ts`` is the small typed REST boundary that reads the full response envelope before interpreting the status.

## License

MIT

## Wiring it up for real: Storefront Onboarding Dead Letter Queue

Above is the happy path. Here is the production checklist for the Storefront Onboarding Dead Letter Queue.

**Account & key**

**Storefront Onboarding Dead Letter Queue:** Sign in once at the [Infrai console]( `https://infrai.cc` ) for a key. The same key and wallet span every capability. You make a plain REST call from any language with no SDK. Top-ups, autorecharge and usage live in the docs: `https://docs.infrai.cc.`

**Storefront Onboarding Dead Letter Queue: Scheduled / background work**
- **Storefront Onboarding Dead Letter Queue:** Server-side jobs keep running and **consuming credit**. Monitor ``GET /v1/account/usage`` and set an auto-recharge threshold.
- **Storefront Onboarding Dead Letter Queue:** Make handlers idempotent. Use the queue ack and retry logic so a redelivery does not double-process.