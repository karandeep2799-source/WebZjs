# Razorpay Standard Checkout

The web-wallet package now includes a server-backed Razorpay Standard Checkout flow for permitted non-crypto goods and services.

## Environment

Copy `.env.example` to `.env` and configure:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RAZORPAY_BUSINESS_NAME` (optional)
- `RAZORPAY_STORE_PATH` (optional)

Use Razorpay **Test Mode** keys during development. The Key Secret and webhook secret must remain server-side and must never be committed.

## Flow

1. `POST /api/razorpay/orders` receives the amount in paise.
2. The Express backend creates the Razorpay Order using Basic Authentication and automatic capture.
3. The backend persists the Razorpay order ID, amount and currency before returning checkout data.
4. The React `Payments` page loads Razorpay's hosted `checkout.js` and opens Checkout only after the user clicks Pay.
5. Checkout returns `razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature` to the browser.
6. `POST /api/razorpay/verify` uses the server-side stored order ID to verify the HMAC-SHA256 signature and fetch the payment from Razorpay.
7. The backend only reports the payment as captured when Razorpay reports `captured`.
8. `POST /api/razorpay/webhook` validates `X-Razorpay-Signature`, rejects stale events, deduplicates event IDs and updates local payment state for `payment.captured`, `payment.failed` and `order.paid`.

## Webhook setup

Configure the Razorpay Dashboard webhook URL as:

`https://YOUR_HOST/api/razorpay/webhook`

Use the same random secret as `RAZORPAY_WEBHOOK_SECRET` and subscribe to at least:

- `payment.captured`
- `payment.failed`
- `order.paid`

The endpoint must be publicly reachable over HTTPS in production.

## Local persistence

For development, orders and webhook event IDs are stored in `data/razorpay.json`, which is ignored by Git. This is intentionally lightweight for the existing WebZjs demo server. For a horizontally scaled production deployment, replace `razorpay-store.js` with a shared database/transaction store so all instances see the same order and webhook state.

## Security

- Never expose `RAZORPAY_KEY_SECRET` to frontend code.
- Never trust a client-supplied amount after an order has been created.
- Verify the payment signature server-side before fulfillment.
- Use the order ID stored by the server for signature verification.
- Compare signatures with a timing-safe comparison.
- Treat webhooks as server-side payment notifications and make event handling idempotent.

## Compliance note

Razorpay's current India documentation states that it does not support online payments for cryptocurrency businesses, and its terms prohibit virtual-currency/crypto products. This integration must therefore not be used to sell, exchange or facilitate payments for Zcash or other crypto assets. Use it only for a Razorpay-approved, non-crypto business use case.
