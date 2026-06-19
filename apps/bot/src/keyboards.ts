import { InlineKeyboard, Keyboard } from 'grammy';
import { config } from './config';
import { t } from './lib/i18n';

/**
 * The welcome "interaction board".
 *   - [🛍 Open Shop]   web_app button -> launches the TMA (full browsing/checkout)
 *   - [📦 My Orders]   callback -> renders an inline order list in-chat
 *   - [🔍 Search]      switch_inline_query_current_chat -> opens inline mode
 *
 * Browsing/checkout deliberately lives in the Mini App; the bot stays a
 * high-conversion entry + notification hub, not a CRUD grid.
 */
export function welcomeKeyboard(locale: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp(t(locale, 'open_shop'), config.miniAppUrl)
    .row()
    .text(t(locale, 'my_orders'), 'orders:list')
    .row()
    // Pre-fills "@bot " in the current chat to trigger inline search.
    .switchInlineCurrent(t(locale, 'search'), '');
}

/** Persistent reply keyboard variant (optional alternative to inline). */
export function welcomeReplyKeyboard(locale: string): Keyboard {
  return new Keyboard()
    .webApp(t(locale, 'open_shop'), config.miniAppUrl)
    .row()
    .text(t(locale, 'my_orders'))
    .text(t(locale, 'search'))
    .resized()
    .persistent();
}
