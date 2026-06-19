import { useEffect, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { formatCents } from '@repo/types';
import { useProduct } from '../features/catalog/useCatalog';
import { useAddToCart } from '../features/cart/useAddToCart';
import { ProductImage } from '../components/ProductImage';
import { useTelegramMainButton, useTelegramBackButton } from '../platform/buttons';
import { watchProduct, unwatchProduct } from '../lib/socket';

export default function ProductPage() {
  const { productId } = useParams({ from: '/p/$productId' });
  const navigate = useNavigate();
  const { data: product, isPending } = useProduct(productId);
  const addToCart = useAddToCart();
  const [variantId, setVariantId] = useState<string | null>(null);

  // Native back button (TMA) -> go home; web renders its own nav.
  useTelegramBackButton(() => navigate({ to: '/' }));

  // Subscribe to this product's live stock updates while the page is open.
  useEffect(() => {
    watchProduct(productId);
    return () => unwatchProduct(productId);
  }, [productId]);

  const selected = product?.variants.find((v) => v.id === (variantId ?? product.variants[0]?.id));
  const soldOut = !selected || selected.availableQty <= 0;

  const handleAdd = () => {
    if (!product || !selected) return;
    addToCart.mutate({
      variantId: selected.id,
      productId: product.id,
      title: product.title,
      options: selected.options,
      unitPriceCents: selected.priceCents,
      qty: 1,
      imageUrl: product.imagePath,
    });
  };

  // Native MainButton in TMA; isNative=false in web -> render the DOM button.
  const { isNative } = useTelegramMainButton({
    text: soldOut ? 'Out of stock' : `Add to cart · ${selected ? formatCents(selected.priceCents, selected.currency) : ''}`,
    onClick: handleAdd,
    enabled: !soldOut,
    loading: addToCart.isPending,
  });

  if (isPending || !product) return <div className="skeleton-card" aria-busy />;

  return (
    <article className="product-detail">
      <ProductImage path={product.imagePath} alt={product.title} width={640} height={640} priority />
      <h1>{product.title}</h1>
      {selected && <p className="price">{formatCents(selected.priceCents, selected.currency)}</p>}
      <p className="stock">
        {soldOut ? 'Sold out' : `${selected!.availableQty} available`}
      </p>

      {product.variants.length > 1 && (
        <div className="variant-picker">
          {product.variants.map((v) => (
            <button
              key={v.id}
              onClick={() => setVariantId(v.id)}
              aria-pressed={selected?.id === v.id}
              disabled={v.availableQty <= 0}
            >
              {Object.values(v.options).join(' / ')}
            </button>
          ))}
        </div>
      )}

      {product.description && <p className="description">{product.description}</p>}

      {/* Web fallback button (hidden in TMA where the native MainButton is used). */}
      {!isNative && (
        <button className="primary-btn" onClick={handleAdd} disabled={soldOut || addToCart.isPending}>
          {addToCart.isPending ? 'Adding…' : soldOut ? 'Out of stock' : 'Add to cart'}
        </button>
      )}
    </article>
  );
}
