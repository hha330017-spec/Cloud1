import { config } from '../config';

/**
 * Server-to-server HTTP client to the NestJS API. The bot authenticates with a
 * service token and forwards the Telegram user id so the API can resolve the
 * app user without a browser session.
 */
async function apiFetch<T>(
  path: string,
  init: RequestInit & { telegramId?: number } = {},
): Promise<T> {
  const { telegramId, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set('Accept', 'application/json');
  if (process.env.BOT_SERVICE_TOKEN) {
    h.set('Authorization', `Bearer ${process.env.BOT_SERVICE_TOKEN}`);
  }
  if (telegramId) h.set('X-Telegram-Id', String(telegramId));

  const res = await fetch(`${config.apiBaseUrl}${path}`, { ...rest, headers: h });
  if (!res.ok) {
    throw new Error(`API ${path} -> ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
}

export function fetchUserOrders(telegramId: number): Promise<{ items: OrderSummary[] }> {
  return apiFetch<{ items: OrderSummary[] }>('/orders?limit=10', { telegramId });
}

export interface SearchHit {
  id: string;
  title: string;
  description?: string;
  fromPriceCents: number;
  currency: string;
  imageUrl?: string;
}

export function searchProducts(query: string): Promise<{ items: SearchHit[] }> {
  const q = encodeURIComponent(query);
  return apiFetch<{ items: SearchHit[] }>(`/products/search?q=${q}&limit=20`);
}
