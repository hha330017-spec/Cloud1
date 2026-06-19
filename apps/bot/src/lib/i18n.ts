/**
 * Tiny dependency-free localization. Resolve the locale dynamically from the
 * user's Telegram language_code (or the app user's stored language). Falls back
 * to English for unknown locales/keys.
 */
type Dict = Record<string, string>;

const STRINGS: Record<string, Dict> = {
  en: {
    welcome: '👋 Welcome to the Marketplace! Browse, search, and check out — right here.',
    open_shop: '🛍 Open Shop',
    my_orders: '📦 My Orders',
    search: '🔍 Search',
    no_orders: 'You have no orders yet. Tap 🛍 Open Shop to start.',
    your_orders: 'Your recent orders:',
    order_paid: '✅ Payment received for order {orderNumber}. We’re preparing it now.',
    order_shipped: '🚚 Order {orderNumber} has shipped! Track it in the app.',
    order_delivered: '📬 Order {orderNumber} was delivered. Enjoy!',
    order_cancelled: '❌ Order {orderNumber} was cancelled.',
    order_refunded: '💸 Order {orderNumber} was refunded.',
    view_order: 'View order',
  },
  ru: {
    welcome: '👋 Добро пожаловать в маркетплейс! Смотрите, ищите и оформляйте заказ прямо здесь.',
    open_shop: '🛍 Открыть магазин',
    my_orders: '📦 Мои заказы',
    search: '🔍 Поиск',
    no_orders: 'У вас пока нет заказов. Нажмите 🛍, чтобы начать.',
    your_orders: 'Ваши последние заказы:',
    order_paid: '✅ Оплата по заказу {orderNumber} получена. Готовим к отправке.',
    order_shipped: '🚚 Заказ {orderNumber} отправлен! Отследите его в приложении.',
    order_delivered: '📬 Заказ {orderNumber} доставлен. Приятных покупок!',
    order_cancelled: '❌ Заказ {orderNumber} отменён.',
    order_refunded: '💸 Возврат по заказу {orderNumber} выполнен.',
    view_order: 'Открыть заказ',
  },
};

const SUPPORTED = Object.keys(STRINGS);

export function resolveLocale(languageCode: string | undefined): string {
  if (!languageCode) return 'en';
  const base = languageCode.split('-')[0]!.toLowerCase();
  return SUPPORTED.includes(base) ? base : 'en';
}

export function t(locale: string, key: string, vars?: Record<string, string>): string {
  const dict = STRINGS[locale] ?? STRINGS.en!;
  let str = dict[key] ?? STRINGS.en![key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, v);
    }
  }
  return str;
}
