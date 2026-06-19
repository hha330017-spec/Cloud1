import { createContext, useContext, type ReactNode } from 'react';
import type { PlatformInfo } from './telegram';

const PlatformContext = createContext<PlatformInfo>({ isTelegram: false });

/**
 * Provides the resolved platform info to the tree. The value is computed once in
 * main.tsx (await initPlatform()) and injected here, so components read it
 * synchronously with no async-in-render.
 */
export function PlatformProvider({
  value,
  children,
}: {
  value: PlatformInfo;
  children: ReactNode;
}) {
  // React 19: Context itself is a valid provider component.
  return <PlatformContext value={value}>{children}</PlatformContext>;
}

export function usePlatform(): PlatformInfo {
  return useContext(PlatformContext);
}
