import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { formatCents } from '@repo/types';
import { useCart } from '../features/cart/useCart';
import { useCheckout, type ShippingAddress } from '../features/cart/useCheckout';
import { useTelegramMainButton, useTelegramBackButton } from '../platform/buttons';

const BLANK: ShippingAddress = {
  fullName: '',
  phone: '',
  line1: '',
  city: '',
  postalCode: '',
  country: '',
};

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { data: cart } = useCart();
  const checkout = useCheckout();
  const [address, setAddress] = useState<ShippingAddress>(BLANK);

  useTelegramBackButton(() => navigate({ to: '/cart' }));

  const valid =
    address.fullName && address.phone && address.line1 && address.city && address.country;

  const submit = () => {
    if (!valid || checkout.isPending) return;
    checkout.mutate(
      { shippingAddress: address },
      {
        onSuccess: (res) => {
          // If the provider returns a hosted checkout URL, hand off to it;
          // otherwise go straight to the order confirmation screen.
          if (res.paymentUrl) {
            window.location.assign(res.paymentUrl);
          } else {
            navigate({ to: '/orders/$orderId', params: { orderId: res.orderId } });
          }
        },
      },
    );
  };

  const { isNative } = useTelegramMainButton({
    text: cart ? `Pay · ${formatCents(cart.subtotalCents, cart.currency)}` : 'Pay',
    onClick: submit,
    enabled: Boolean(valid),
    loading: checkout.isPending,
  });

  const set = (k: keyof ShippingAddress) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((a) => ({ ...a, [k]: e.target.value }));

  return (
    <form className="checkout" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <h1>Shipping</h1>
      <input placeholder="Full name" value={address.fullName} onChange={set('fullName')} required />
      <input placeholder="Phone" value={address.phone} onChange={set('phone')} required />
      <input placeholder="Address" value={address.line1} onChange={set('line1')} required />
      <input placeholder="City" value={address.city} onChange={set('city')} required />
      <input placeholder="Postal code" value={address.postalCode} onChange={set('postalCode')} />
      <input placeholder="Country" value={address.country} onChange={set('country')} required />

      {checkout.isError && (
        <p role="alert" className="error">
          {checkout.error.message}
        </p>
      )}

      {!isNative && (
        <button type="submit" className="primary-btn" disabled={!valid || checkout.isPending}>
          {checkout.isPending
            ? 'Processing…'
            : `Pay ${cart ? formatCents(cart.subtotalCents, cart.currency) : ''}`}
        </button>
      )}
    </form>
  );
}
