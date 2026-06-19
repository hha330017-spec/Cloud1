import { Outlet, Link, useRouterState } from '@tanstack/react-router';
import { Suspense } from 'react';
import { usePlatform } from '../platform/PlatformProvider';

/**
 * Root layout. Renders its own chrome (header + bottom nav) ONLY in web mode;
 * inside Telegram these are hidden (.web-only) because the native client already
 * provides the header and the BackButton is driven via useTelegramBackButton.
 */
export function AppShell() {
  const { isTelegram } = usePlatform();
  const isLoading = useRouterState({ select: (s) => s.status === 'pending' });

  return (
    <div className="app-shell">
      {!isTelegram && (
        <header className="web-only app-header">
          <Link to="/" className="brand">
            Marketplace
          </Link>
          <Link to="/cart" aria-label="Cart">
            🛒
          </Link>
        </header>
      )}

      {isLoading && <div className="route-progress" aria-hidden />}

      <main className="app-content">
        {/* Suspense boundary catches the lazy route chunk while it loads. */}
        <Suspense fallback={<RouteSkeleton />}>
          <Outlet />
        </Suspense>
      </main>

      {!isTelegram && (
        <nav className="web-only bottom-nav">
          <Link to="/">Home</Link>
          <Link to="/cart">Cart</Link>
          <Link to="/orders">Orders</Link>
        </nav>
      )}
    </div>
  );
}

/** Skeleton (not a spinner) for better perceived performance on slow networks. */
function RouteSkeleton() {
  return (
    <div className="skeleton-grid" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
    </div>
  );
}
