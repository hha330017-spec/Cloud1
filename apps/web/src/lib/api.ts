import { env } from './env';

/** Bearer token kept in memory only (refresh lives in an httpOnly cookie). */
let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Structured error matching the API's { error: { code, message, traceId } }. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** When set, sent as the `Idempotency-Key` header (POST/PATCH safety). */
  idempotencyKey?: string;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers, ...rest } = opts;
  const h = new Headers(headers);
  h.set('Accept', 'application/json');
  if (body !== undefined) h.set('Content-Type', 'application/json');
  if (accessToken) h.set('Authorization', `Bearer ${accessToken}`);
  if (idempotencyKey) h.set('Idempotency-Key', idempotencyKey);

  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    ...rest,
    headers: h,
    // include refresh cookie for auth endpoints
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let payload: { error?: { code?: string; message?: string; traceId?: string } } = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(
      res.status,
      payload.error?.code ?? 'UNKNOWN',
      payload.error?.message ?? res.statusText,
      payload.error?.traceId,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Stable idempotency key generator (per logical operation attempt). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
