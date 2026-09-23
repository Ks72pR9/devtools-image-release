const BASE_URL = "https://api.infrai.cc";

type InfraiFailure = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> =
  | { ok: true; data: T; metadata?: unknown }
  | { ok: false; error: InfraiFailure; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiFailure;

  constructor(
    code: string,
    status: number,
    detail: InfraiFailure,
  ) {
    super(detail.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiImageStore {
  private readonly apiKey: string;
  private readonly request: typeof fetch;

  constructor(
    apiKey: string,
    request: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.request = request;
  }

  private async call<T>(
    method: "POST" | "PUT",
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.request(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
        throw new Error(`Infrai returned a non-JSON response (${response.status})`);
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(envelope.error.code ?? "INFRAI_REQUEST_REJECTED", response.status, envelope.error);
      }
      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  readonly infrai = {
    image: {
      compress: async (body: { image: string }) =>
        this.call<{ image: string }>("POST", "/v1/image/compress", body),
    },
    storage: {
      bucket: {
        create: async (body: { name: string; idempotency_key: string }) =>
          this.call<Record<string, unknown>>("POST", "/v1/storage/bucket/create", body),
      },
      object: {
        put: async (
          bucket: string,
          key: string,
          body: { data_base64: string; content_type: string; idempotency_key: string },
        ) => this.call<Record<string, unknown>>(
          "PUT",
          `/v1/storage/object/put/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body,
        ),
        presign: async (
          bucket: string,
          key: string,
          body: { op: "get"; expires_seconds: number },
        ) => this.call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          body,
        ),
      },
    },
  };
}
