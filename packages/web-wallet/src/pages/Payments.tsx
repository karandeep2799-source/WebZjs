import { useEffect, useState } from 'react';

const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayConfig {
  enabled: boolean;
  keyId: string | null;
  businessName: string;
}

interface RazorpayOrderResponse {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
}

interface RazorpayVerifyResponse {
  verified: boolean;
  orderId: string;
  paymentId: string;
  status: string;
  captured: boolean;
}

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_CHECKOUT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load Razorpay Checkout')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Razorpay Checkout'));
    document.body.appendChild(script);
  });
}

export default function Payments() {
  const [config, setConfig] = useState<RazorpayConfig | null>(null);
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [lastPayment, setLastPayment] = useState<RazorpayVerifyResponse | null>(null);

  useEffect(() => {
    fetch('/api/razorpay/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load Razorpay configuration');
        return response.json() as Promise<RazorpayConfig>;
      })
      .then(setConfig)
      .catch((error) => setMessage(error.message));
  }, []);

  async function startPayment() {
    setMessage('');
    setLastPayment(null);

    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees < 1 || rupees > 500000) {
      setMessage('Enter an amount from ₹1 to ₹5,00,000.');
      return;
    }

    setLoading(true);
    try {
      const orderResponse = await fetch('/api/razorpay/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(rupees * 100) }),
      });

      const orderBody = await orderResponse.json();
      if (!orderResponse.ok) throw new Error(orderBody.error || 'Unable to create payment order');

      const order = orderBody as RazorpayOrderResponse;
      await loadRazorpayCheckout();
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable');

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: config?.businessName || 'WebZjs',
        description: 'WebZjs service payment',
        order_id: order.orderId,
        theme: { color: '#f97316' },
        handler: async (response) => {
          try {
            const verifyResponse = await fetch('/api/razorpay/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            });
            const verifyBody = await verifyResponse.json();
            if (!verifyResponse.ok) throw new Error(verifyBody.error || 'Payment verification failed');

            const verified = verifyBody as RazorpayVerifyResponse;
            setLastPayment(verified);
            setMessage(
              verified.captured
                ? 'Payment verified and captured.'
                : `Payment verified with status: ${verified.status}`,
            );
          } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Payment verification failed');
          } finally {
            setLoading(false);
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      });

      checkout.open();
    } catch (error) {
      setLoading(false);
      setMessage(error instanceof Error ? error.message : 'Unable to start payment');
    }
  }

  return (
    <main className="px-5 py-8 max-w-[680px] mx-auto w-full">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Razorpay Payments</h1>
        <p className="mt-2 text-sm text-gray-600">
          Standard Checkout is connected to the WebZjs backend. Orders are created server-side and
          payment signatures are verified before a payment is marked as captured.
        </p>

        <label className="block mt-6 text-sm font-medium text-gray-800" htmlFor="razorpay-amount">
          Amount (INR)
        </label>
        <div className="mt-2 flex items-center rounded-lg border border-gray-300 px-3">
          <span className="text-gray-500">₹</span>
          <input
            id="razorpay-amount"
            className="w-full px-2 py-3 outline-none"
            inputMode="decimal"
            min="1"
            max="500000"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>

        <button
          type="button"
          disabled={loading || config?.enabled === false || config === null}
          onClick={startPayment}
          className="mt-5 w-full rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Opening Razorpay…' : `Pay ₹${amount || '0'}`}
        </button>

        {config && !config.enabled && (
          <p className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-900">
            Razorpay is not configured. Add the server-side API credentials to the wallet environment.
          </p>
        )}

        {message && (
          <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-800" role="status">
            {message}
          </p>
        )}

        {lastPayment && (
          <div className="mt-4 rounded-lg border border-gray-200 p-4 text-sm">
            <div className="font-semibold">Payment details</div>
            <div className="mt-2 break-all">Order: {lastPayment.orderId}</div>
            <div className="break-all">Payment: {lastPayment.paymentId}</div>
            <div>Status: {lastPayment.status}</div>
          </div>
        )}
      </div>
    </main>
  );
}
