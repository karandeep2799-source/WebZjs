# WebZjs Web Wallet

## Razorpay Standard Checkout

The web wallet now includes a Test Mode-ready Razorpay Standard Checkout flow.

### Server environment

Set these variables in `packages/web-wallet/.env`:

```env
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=use-a-long-random-secret
```

`RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are server-only secrets. Never expose them to browser code or commit real credentials.

### Run locally

```bash
yarn workspace @chainsafe/webzjs-web-wallet run dev
```

Open the wallet, connect the Snap, then use **Payment** in the dashboard navigation.

### Payment flow

1. The browser requests an order from `POST /api/razorpay/orders`.
2. The Express backend creates the Razorpay Order with the secret credentials.
3. The browser opens Razorpay Checkout with the returned `order_id`.
4. The Checkout handler sends the payment ID, order ID, and signature to `POST /api/razorpay/verify`.
5. The backend verifies the HMAC signature and fetches the payment from Razorpay before reporting success.
6. `POST /api/razorpay/webhook` validates raw-body webhook signatures and tracks captured/failed payment events.

### Production note

The current server-side order registry is intentionally lightweight for the existing development server. Before production, replace the in-memory order/event maps in `server/razorpay.js` with durable storage and move webhook processing to a background queue. The payment should only be fulfilled after Razorpay reports it as `captured`.
