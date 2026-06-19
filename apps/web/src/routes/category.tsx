import { Link, useParams, useNavigate } from '@tanstack/react-router';
import { formatCents } from '@repo/types';
import { useProducts } from '../features/catalog/useCatalog';
import { ProductImage } from '../components/ProductImage';
import { useTelegramBackButton } from '../platform/buttons';

export default function CategoryPage() {
  const { category } = useParams({ from: '/c/$category' });
  const navigate = useNavigate();
  const { data, isPending } = useProducts({ category });

  useTelegramBackButton(() => navigate({ to: '/' }));

  if (isPending) return <div className="skeleton-grid" aria-busy />;

  return (
    <div className="product-grid">
      {data.items.map((p, i) => (
        <Link key={p.id} to="/p/$productId" params={{ productId: p.id }} className="card">
          <ProductImage path={p.imagePath} alt={p.title} width={240} height={240} priority={i < 4} />
          <span className="card-title">{p.title}</span>
          <span className="card-price">{formatCents(p.fromPriceCents, p.currency)}</span>
        </Link>
      ))}
    </div>
  );
}
