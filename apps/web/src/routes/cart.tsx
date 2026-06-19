import { useNavigate } from '@tanstack/react-router';
import { formatCents } from '@repo/types';
import { useCart } from '../features/cart/useCart';
import { ProductImage } from '../components/ProductImage';
import { useTelegramMainButton, useTelegramBackButton } from '../platform/buttons';

export default function CartPage() {
  const navigate = useNavigate();
  const { data: cart, isPending } = useCart();

  useTelegramBackButton(() => navigate({ to: '/' }));

  const empty = !cart || cart.items.length === 0;

  const { isNative } = useTelegramMainButton({
    text: cart ? `Checkout · ${formatCents(cart.subtotalCents, cart.currency)}` : 'Checkout',
    onClick: () => navigate({ to: '/checkout' }),
    visible: !empty,
    enabled: !empty,
  });

  if (isPending) return <div className="skeleton-card" aria-busy />;
  if (empty) return <p className="empty">Your cart is empty.</p>;

  return (
    <div className="cart">
      <ul className="cart-items">
        {cart.items.map((item) => (
          <li key={item.id} className="cart-item">
            {item.imageUrl && (
              <ProductImage path={item.imageUrl} alt={item.title} width={64} height={64} />
            )}
            <div>
              <span className="title">{item.title}</span>
              <span className="opts">{Object.values(item.options).join(' / ')}</span>
              <span className="qty">×{item.qty}</span>
            </div>
            <span className="line-total">
              {formatCents(item.unitPriceCents * item.qty, cart.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className="cart-summary">
        <span>Subtotal</span>
        <strong>{formatCents(cart.subtotalCents, cart.currency)}</strong>
      </div>

      {!isNative && (
        <button className="primary-btn" onClick={() => navigate({ to: '/checkout' })}>
          Checkout · {formatCents(cart.subtotalCents, cart.currency)}
        </button>
      )}
    </div>
  );
}
