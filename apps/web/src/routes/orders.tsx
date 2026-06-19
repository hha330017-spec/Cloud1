import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { formatCents } from '@repo/types';
import { apiFetch } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useTelegramBackButton } from '../platform/buttons';

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
}

export default function OrdersPage() {
  const navigate = useNavigate();
  useTelegramBackButton(() => navigate({ to: '/' }));

  const { data, isPending } = useQuery({
    queryKey: qk.orders(),
    queryFn: () => apiFetch<{ items: OrderSummary[] }>('/orders'),
    meta: { persist: false },
  });

  if (isPending) return <div className="skeleton-card" aria-busy />;
  if (!data || data.items.length === 0) return <p className="empty">No orders yet.</p>;

  return (
    <ul className="orders">
      {data.items.map((o) => (
        <li key={o.id}>
          <Link to="/orders/$orderId" params={{ orderId: o.id }}>
            <span>{o.orderNumber}</span>
            <span className={`status status-${o.status}`}>{o.status}</span>
            <span>{formatCents(o.totalCents, o.currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
