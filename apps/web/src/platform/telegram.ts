import {
  isTMA,
  init as initSDK,
  retrieveLaunchParams,
  viewport,
  themeParams,
  miniApp,
  backButton,
  mainButton,
} from '@telegram-apps/sdk-react';

export interface PlatformInfo {
  /** True only when running inside a real Telegram client. */
  isTelegram: boolean;
  /** Raw start param (tgWebAppStartParam) for deep-link routing. */
  startParam?: string;
}

/** Swallow errors from SDK calls that are unsupported on a given TG version/web. */
function safe(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (import.meta.env.DEV) console.warn(`[platform] ${label} skipped:`, err);
  }
}

let cached: PlatformInfo | null = null;

/**
 * Detects the runtime and binds the Telegram context exactly once.
 *
 * In TMA mode it:
 *   - initialises the SDK event bridge
 *   - mounts + expands the viewport to full height and binds safe-area CSS vars
 *   - binds theme params -> `--tg-theme-*` CSS variables (so the UI matches the
 *     user's Telegram light/dark theme automatically)
 *   - mounts MainButton & BackButton so React hooks can drive the NATIVE buttons
 *
 * In web mode it does nothing but tag <html data-platform="web"> and lets the
 * CSS fallback variables in theme.css take over.
 *
 * Must be awaited before first render (viewport.mount is async).
 */
export async function initPlatform(): Promise<PlatformInfo> {
  if (cached) return cached;

  let telegram = false;
  safe('isTMA', () => {
    telegram = isTMA();
  });

  const root = document.documentElement;

  if (!telegram) {
    root.dataset.platform = 'web';
    cached = { isTelegram: false };
    return cached;
  }

  // ---- Telegram Mini App branch ----
  root.dataset.platform = 'tma';
  safe('init', () => initSDK());

  // Theme params -> `--tg-theme-bg-color`, `--tg-theme-text-color`, etc.
  safe('themeParams', () => {
    themeParams.mount();
    themeParams.bindCssVars();
  });

  // Mini app surface vars + match header/background to theme.
  safe('miniApp', () => {
    miniApp.mount();
    miniApp.bindCssVars();
  });

  // Expand to full height and expose safe-area insets as CSS vars.
  if (viewport.mount.isAvailable()) {
    try {
      await viewport.mount();
      safe('viewport.expand', () => viewport.expand());
      safe('viewport.bindCssVars', () => viewport.bindCssVars());
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[platform] viewport.mount failed', err);
    }
  }

  // Pre-mount native buttons so per-route hooks can show/configure them instantly.
  safe('backButton.mount', () => backButton.mount());
  safe('mainButton.mount', () => mainButton.mount());

  let startParam: string | undefined;
  safe('retrieveLaunchParams', () => {
    startParam = retrieveLaunchParams().tgWebAppStartParam ?? undefined;
  });

  cached = { isTelegram: true, startParam };
  return cached;
}
