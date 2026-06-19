import { Link } from '@tanstack/react-router';
import { useProducts } from '../features/catalog/useCatalog';
import { ProductImage } from '../components/ProductImage';
import { formatCents } from '@repo/types';

/** Catalog home. Default export so router.tsx can lazy-import it as a chunk. */
export default function HomePage() {
  const { data, isPending, isError } = useProducts();

  if (isPending) return <div className="skeleton-grid" aria-busy />;
  if (isError) return <p role="alert">Couldn’t load products. Pull to retry.</p>;

  return (
    <div className="product-grid">
      {data.items.map((p, i) => (
        <Link key={p.id} to="/p/$productId" params={{ productId: p.id }} className="card">
          <ProductImage
            path={p.imagePath}
            alt={p.title}
            width={240}
            height={240}
            priority={i < 4 /* eager-load only the first visible row */}
          />
          <span className="card-title">{p.title}</span>
          <span className="card-price">{formatCents(p.fromPriceCents, p.currency)}</span>
        </Link>
      ))}
    </div>
  );
}
