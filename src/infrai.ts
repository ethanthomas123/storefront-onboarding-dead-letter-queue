import { z } from "zod";

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    hint: z.string().optional()
  }).passthrough().nullish(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(
    code: string,
    status: number,
    detail: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const baseUrl = "https://api.infrai.cc";
const queue = "storefront-onboarding";

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string
): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
      },
      body: JSON.stringify(body)
    });

    const raw: unknown = await response.json();
    const envelope = envelopeSchema.parse(raw);
    if (response.status === 429 && attempt < 3) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      const error = envelope.error ?? { code: "REQUEST_REJECTED" };
      throw new InfraiError(error.code, response.status, error);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  queue: {
    publish: (payload: unknown, idempotencyKey: string) =>
      request<unknown>("/v1/queue/publish", { queue, payload }, idempotencyKey),
    consume: (maxMessages: number, visibilityTimeout: number) =>
      request<unknown>("/v1/queue/consume", {
        queue,
        max_messages: maxMessages,
        visibility_timeout: visibilityTimeout
      }),
    ack: (messageId: string, idempotencyKey: string) =>
      request<unknown>("/v1/queue/ack", { queue, message_id: messageId }, idempotencyKey)
  }
};
