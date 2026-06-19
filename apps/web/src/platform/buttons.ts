import { useEffect } from 'react';
import { mainButton, backButton, hapticFeedback } from '@telegram-apps/sdk-react';
import { usePlatform } from './PlatformProvider';

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* unsupported version / web mode */
  }
}

export interface MainButtonOptions {
  text: string;
  onClick: () => void;
  visible?: boolean;
  enabled?: boolean;
  loading?: boolean;
}

/**
 * Drives the NATIVE Telegram MainButton in TMA mode. Returns `{ isNative }` so
 * the caller can render its own DOM button when `isNative` is false (web mode).
 *
 * Usage:
 *   const { isNative } = useTelegramMainButton({ text: 'Pay $42.00', onClick: pay });
 *   return isNative ? null : <button onClick={pay}>Pay $42.00</button>;
 */
export function useTelegramMainButton(opts: MainButtonOptions): { isNative: boolean } {
  const { isTelegram } = usePlatform();
  const { text, onClick, visible = true, enabled = true, loading = false } = opts;

  useEffect(() => {
    if (!isTelegram) return;

    safe(() =>
      mainButton.setParams({
        text,
        isVisible: visible,
        isEnabled: enabled && !loading,
        isLoaderVisible: loading,
      }),
    );

    let off: (() => void) | undefined;
    safe(() => {
      off = mainButton.onClick(onClick);
    });

    return () => {
      safe(() => off?.());
      // Hide on unmount so the button doesn't leak across routes.
      safe(() => mainButton.setParams({ isVisible: false }));
    };
  }, [isTelegram, text, onClick, visible, enabled, loading]);

  return { isNative: isTelegram };
}

/**
 * Drives the native BackButton in TMA mode. In web mode returns isNative=false
 * so the layout can render a DOM back chevron instead.
 */
export function useTelegramBackButton(onBack: () => void, show = true): { isNative: boolean } {
  const { isTelegram } = usePlatform();

  useEffect(() => {
    if (!isTelegram) return;

    let off: (() => void) | undefined;
    safe(() => {
      if (show) backButton.show();
      else backButton.hide();
      off = backButton.onClick(onBack);
    });

    return () => {
      safe(() => off?.());
      safe(() => backButton.hide());
    };
  }, [isTelegram, onBack, show]);

  return { isNative: isTelegram };
}

/** Haptic feedback that no-ops outside Telegram. Use on add-to-cart, pay, etc. */
export function useHaptics() {
  const { isTelegram } = usePlatform();
  return {
    impact: (style: 'light' | 'medium' | 'heavy' = 'light') => {
      if (isTelegram) safe(() => hapticFeedback.impactOccurred(style));
    },
    notify: (type: 'error' | 'success' | 'warning') => {
      if (isTelegram) safe(() => hapticFeedback.notificationOccurred(type));
    },
  };
}
