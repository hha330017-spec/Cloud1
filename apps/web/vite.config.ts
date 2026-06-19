import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config/
// Routing is code-based (src/router.tsx) using lazyRouteComponent for per-route
// code splitting, so no route-tree codegen plugin is required.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'analyze' &&
      visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true }),
  ].filter(Boolean),

  build: {
    target: 'es2022',
    cssCodeSplit: true,
    // Surface regressions early: fail the build if a chunk balloons.
    chunkSizeWarningLimit: 160,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Keep the initial (entry) bundle lean by splitting heavy, rarely-changing
        // vendors into long-cacheable chunks loaded in parallel. Route code is
        // already split by TanStack Router lazy routes, so the entry chunk holds
        // only the shell + router + query core.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react') || id.includes('scheduler')) return 'react';
          if (id.includes('@tanstack')) return 'tanstack';
          if (id.includes('@telegram-apps')) return 'telegram';
          if (id.includes('socket.io') || id.includes('engine.io')) return 'socket';
          return 'vendor';
        },
      },
    },
  },

  server: { port: 5173, host: true },
}));
