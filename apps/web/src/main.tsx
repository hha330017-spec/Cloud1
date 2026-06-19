import './styles/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { retrieveRawInitData } from '@telegram-apps/sdk-react';

import { router } from './router';
import { queryClient, persistOptions } from './lib/queryClient';
import { apiFetch, setAccessToken } from './lib/api';
import { connectRealtime, type RealtimeAuth } from './lib/socket';
import { initPlatform, type PlatformInfo } from './platform/telegram';
import { PlatformProvider } from './platform/PlatformProvider';
import { resolveDeepLink, readStartParam } from './platform/deeplink';

/**
 * In TMA mode, exchange Telegram initData for our own session JWT. The server
 * validates the initData HMAC (see API auth) and returns a token + identity used
 * to authenticate REST calls and to join the right realtime rooms.
 */
async function bootstrapSession(platform: PlatformInfo): Promise<RealtimeAuth> {
  if (!platform.isTelegram) return {};
  try {
    const initData = retrieveRawInitData();
    const session = await apiFetch<{ token: string; userId: string; vendorId?: string }>(
      '/auth/telegram',
      { method: 'POST', body: { initData } },
    );
    setAccessToken(session.token);
    return { token: session.token, userId: session.userId, vendorId: session.vendorId };
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[auth] telegram session bootstrap failed', err);
    return {};
  }
}

async function boot(): Promise<void> {
  // 1) Detect environment + bind Telegram context (theme, viewport, buttons).
  const platform = await initPlatform();

  // 2) Establish a session, then open the realtime channel and wire it into
  //    the query cache (reconciliation engine).
  const auth = await bootstrapSession(platform);
  connectRealtime(queryClient, auth);

  // 3) Deep-link: if launched via tgWebAppStartParam (or ?startapp= on web),
  //    route straight to the target BEFORE first paint so the user lands deep.
  const target = resolveDeepLink(readStartParam(platform.startParam));
  if (target) {
    // `to` is a runtime-resolved path; cast to satisfy the strict navigate API.
    await router.navigate(target as Parameters<typeof router.navigate>[0]);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PlatformProvider value={platform}>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <RouterProvider router={router} />
        </PersistQueryClientProvider>
      </PlatformProvider>
    </StrictMode>,
  );
}

void boot();
