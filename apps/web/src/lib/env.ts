/** Typed access to build-time env. Centralised so usage sites stay clean. */
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/v1',
  wsUrl: import.meta.env.VITE_WS_URL ?? '',
  cdnBaseUrl: import.meta.env.VITE_CDN_BASE_URL ?? '',
} as const;
