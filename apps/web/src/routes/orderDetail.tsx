import { useParams, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { formatCents } from '@repo/types';
import { apiFetch } from '../lib/api';
import { qk } from '../lib/queryKeys';
import { useTelegramBackButton } from '../platform/buttons';

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  items: Array<{ id: string; title: string; qty: number; unitPriceCents: number }>;
}

export default function OrderDetailPage() {
  const { orderId } = useParams({ from: '/orders/$orderId' });
  const navigate = useNavigate();
  useTelegramBackButton(() => navigate({ to: '/orders' }));

  // Live status updates arrive via the websocket bridge (invalidates qk.order).
  const { data: order, isPending } = useQuery({
    queryKey: qk.order(orderId),
    queryFn: () => apiFetch<OrderDetail>(`/orders/${orderId}`),
    meta: { persist: false },
  });

  if (isPending || !order) return <div className="skeleton-card" aria-busy />;

  return (
    <article className="order-detail">
      <header>
        <h1>{order.orderNumber}</h1>
        <span className={`status status-${order.status}`}>{order.status}</span>
      </header>
      <ul>
        {order.items.map((it) => (
          <li key={it.id}>
            {it.title} ×{it.qty} — {formatCents(it.unitPriceCents * it.qty, order.currency)}
          </li>
        ))}
      </ul>
      <div className="total">
        Total <strong>{formatCents(order.totalCents, order.currency)}</strong>
      </div>
    </article>
  );
}
