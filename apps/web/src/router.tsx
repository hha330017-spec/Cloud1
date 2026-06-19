import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { AppShell } from './components/AppShell';

/**
 * Code-based routing with per-route code splitting.
 *
 * lazyRouteComponent(() => import(...)) emits each page as its own async chunk,
 * so the initial (entry) bundle contains only the shell + router + query core.
 * Combined with manualChunks in vite.config, this keeps first load < 150KB gz.
 */
const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./routes/home')),
});

const categoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/$category',
  component: lazyRouteComponent(() => import('./routes/category')),
});

const productRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$productId',
  component: lazyRouteComponent(() => import('./routes/product')),
});

const cartRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cart',
  component: lazyRouteComponent(() => import('./routes/cart')),
});

const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/checkout',
  component: lazyRouteComponent(() => import('./routes/checkout')),
});

const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders',
  component: lazyRouteComponent(() => import('./routes/orders')),
});

const orderDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders/$orderId',
  component: lazyRouteComponent(() => import('./routes/orderDetail')),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  categoryRoute,
  productRoute,
  cartRoute,
  checkoutRoute,
  ordersRoute,
  orderDetailRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent', // prefetch route chunk + data on hover/touchstart
  defaultPreloadStaleTime: 0, // let TanStack Query own data freshness
  scrollRestoration: true,
});

// Type-safe routing: register the router instance for global inference.
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
