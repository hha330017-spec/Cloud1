export interface Variant {
  id: string;
  sku: string;
  options: Record<string, string>;
  priceCents: number;
  currency: string;
  availableQty: number;
  version: number;
}

export interface Product {
  id: string;
  vendorId: string;
  title: string;
  description?: string;
  imagePath: string;
  variants: Variant[];
}

export interface ProductCard {
  id: string;
  title: string;
  imagePath: string;
  fromPriceCents: number;
  currency: string;
}

export interface ProductPage {
  items: ProductCard[];
  nextCursor?: string;
}
