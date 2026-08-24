import React, { useEffect, useState } from 'react';

const RAZORPAY_CHECKOUT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

type RazorpayConfig = {
  keyId: string | null;
  enabled: boolean;
};

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
};

type RazorpaySuccessResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

function loadRazorpayScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Razorpay) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_CHECKOUT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load Razorpay Checkout.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Razorpay Checkout.'));
    document.body.appendChild(script);
  });
}

const RazorpayPayment: React.FC = () => {
  const [config, setConfig] = useState<RazorpayConfig | null>(null);
  const [amount, setAmount] = useState('100');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/razorpay/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load payment configuration.');
        return response.json() as Promise<RazorpayConfig>;
      })
      .then(setConfig)
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const handlePayment = async () => {
    setBusy(true);
    setMessage(null);
    setSuccess(false);

    try {
      const rupees = Number(amount);
      if (!Number.isFinite(rupees) || rupees < 1) {
        throw new Error('Enter an amount of at least ₹1.');
      }

      if (!config?.enabled || !config.keyId) {
        throw new Error('Razorpay is not configured on the server yet.');
      }

      await loadRazorpayScript();
      if (!window.Razorpay) throw new Error('Razorpay Checkout is unavailable.');

      const orderResponse = await fetch('/api/razorpay/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(rupees * 100),
          currency: 'INR',
          notes: { source: 'webzjs-web-wallet' },
        }),
      });

      const orderBody = (await orderResponse.json()) as RazorpayOrder | { error?: string };
      if (!orderResponse.ok || !('id' in orderBody)) {
        throw new Error(('error' in orderBody && orderBody.error) || 'Unable to create Razorpay order.');
      }

      const order = orderBody;

      const checkout = new window.Razorpay({
        key: config.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'WebZjs',
        description: 'WebZjs payment',
        order_id: order.id,
        prefill: {
          name: name || undefined,
          email: email || undefined,
          contact: contact || undefined,
        },
        theme: { color: '#111827' },
        handler: async (response: unknown) => {
          try {
            const payment = response as RazorpaySuccessResponse;
            const verifyResponse = await fetch('/api/razorpay/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payment),
            });
            const verification = await verifyResponse.json();
            if (!verifyResponse.ok || !verification.verified) {
              throw new Error(verification.error || 'Payment verification failed.');
            }

            setSuccess(true);
            setMessage(
              verification.captured
                ? `Payment captured successfully. Payment ID: ${verification.paymentId}`
                : `Payment verified but is ${verification.status}. Wait for capture before fulfilment.`,
            );
          } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
          } finally {
            setBusy(false);
          }
        },
      });

      checkout.on('payment.failed', (response: unknown) => {
        const failure = response as { error?: { description?: string } };
        setMessage(failure?.error?.description || 'Payment failed or was cancelled.');
        setBusy(false);
      });

      checkout.open();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">Razorpay Payment</h1>
        <p className="text-sm text-gray-600 mb-6">
          Test the Razorpay Standard Checkout flow from the WebZjs web wallet.
        </p>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Amount (INR)</span>
            <input
              inputMode="decimal"
              min="1"
              step="0.01"
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:ring-2 focus:ring-gray-900"
            />
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3" />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Phone</span>
            <input inputMode="tel" value={contact} onChange={(event) => setContact(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-4 py-3" placeholder="10-digit mobile number" />
          </label>

          <button
            type="button"
            onClick={handlePayment}
            disabled={busy || config === null || !config.enabled}
            className="w-full rounded-xl bg-gray-900 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Opening Razorpay…' : 'Pay with Razorpay'}
          </button>
        </div>

        {config && !config.enabled && (
          <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
            Configure <code>RAZORPAY_KEY_ID</code> and <code>RAZORPAY_KEY_SECRET</code> in the web-wallet server environment first.
          </div>
        )}

        {message && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${success ? 'bg-green-50 border-green-200 text-green-900' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

export default RazorpayPayment;
