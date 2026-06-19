import type { Context } from 'grammy';

/**
 * Custom context. Extend here when adding session/i18n middleware so handlers
 * stay strongly typed.
 */
export type BotContext = Context & {
  // populated by middleware (e.g. resolved app user / locale)
  locale: string;
};
