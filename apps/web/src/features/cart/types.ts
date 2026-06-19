export interface CartItem {
  id: string;
  variantId: string;
  productId: string;
  title: string;
  options: Record<string, string>;
  unitPriceCents: number;
  qty: number;
  imageUrl?: string;
}

export interface Cart {
  id: string;
  items: CartItem[];
  subtotalCents: number;
  currency: string;
}

/** Everything the UI needs to optimistically render a newly-added line. */
export interface AddToCartInput {
  variantId: string;
  productId: string;
  title: string;
  options: Record<string, string>;
  unitPriceCents: number;
  qty: number;
  imageUrl?: string;
}

export const EMPTY_CART: Cart = {
  id: 'local',
  items: [],
  subtotalCents: 0,
  currency: 'USD',
};

/** Pure reducer: apply an add (merge qty if the variant already exists). */
export function applyAdd(current: Cart | undefined, input: AddToCartInput): Cart {
  const cart = current ?? EMPTY_CART;
  const idx = cart.items.findIndex((i) => i.variantId === input.variantId);

  let items: CartItem[];
  if (idx >= 0) {
    items = cart.items.map((i, n) =>
      n === idx ? { ...i, qty: i.qty + input.qty } : i,
    );
  } else {
    items = [
      ...cart.items,
      {
        // temp id; replaced by the server's real id on reconciliation
        id: `optimistic-${input.variantId}`,
        variantId: input.variantId,
        productId: input.productId,
        title: input.title,
        options: input.options,
        unitPriceCents: input.unitPriceCents,
        qty: input.qty,
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      },
    ];
  }

  return { ...cart, items, subtotalCents: recomputeSubtotal(items) };
}

export function recomputeSubtotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.qty, 0);
}
