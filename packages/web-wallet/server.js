import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Parcel } from '@parcel/core';
import history from 'connect-history-api-fallback';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import {
  getOrder,
  hasEvent,
  initRazorpayStore,
  saveEvent,
  saveOrder,
  updateOrder,
} from './razorpay-store.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RAZORPAY_API = 'https://api.razorpay.com/v1';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

function requireRazorpayConfig(res) {
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    res.status(503).json({ error: 'Razorpay is not configured on the server' });
    return false;
  }
  return true;
}

function basicAuth() {
  return `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

function timingSafeEqualHex(left, right) {
  const a = Buffer.from(left || '', 'utf8');
  const b = Buffer.from(right || '', 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function razorpayRequest(path, options = {}) {
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.description || `Razorpay request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.razorpay = body;
    throw error;
  }
  return body;
}

function sanitizeAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 50_000_000) {
    throw new Error('Amount must be between ₹1 and ₹5,00,000, expressed in paise');
  }
  return amount;
}

async function createRazorpayOrder(req, res) {
  if (!requireRazorpayConfig(res)) return;

  try {
    const amount = sanitizeAmount(req.body?.amount);
    const receipt = `wz_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const order = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt,
        capture: 'automatic',
        notes: {
          source: 'webzjs-web-wallet',
        },
      }),
    });

    await saveOrder({
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      paymentId: null,
      signature: null,
      createdAt: new Date().toISOString(),
    });

    res.json({
      keyId: RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error('Razorpay order creation failed:', error.message);
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function verifyRazorpayPayment(req, res) {
  if (!requireRazorpayConfig(res)) return;

  try {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'Missing Razorpay verification fields' });
    }

    const order = getOrder(orderId);
    if (!order) {
      return res.status(400).json({ error: 'Unknown Razorpay order' });
    }

    const expected = hmacSha256(RAZORPAY_KEY_SECRET, `${order.razorpayOrderId}|${paymentId}`);
    if (!timingSafeEqualHex(expected, signature)) {
      return res.status(400).json({ error: 'Razorpay signature verification failed' });
    }

    const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
    if (payment.order_id !== order.razorpayOrderId || payment.amount !== order.amount || payment.currency !== order.currency) {
      return res.status(400).json({ error: 'Payment does not match the server-side order' });
    }

    const status = payment.status === 'captured' ? 'paid' : payment.status;
    await updateOrder(order.razorpayOrderId, {
      paymentId,
      signature,
      status,
    });

    res.json({
      verified: true,
      orderId: order.razorpayOrderId,
      paymentId,
      status,
      captured: payment.status === 'captured',
    });
  } catch (error) {
    console.error('Razorpay verification failed:', error.message);
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function getRazorpayOrderStatus(req, res) {
  if (!requireRazorpayConfig(res)) return;

  try {
    const order = getOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Unknown Razorpay order' });

    const remoteOrder = await razorpayRequest(`/orders/${encodeURIComponent(order.razorpayOrderId)}`);
    const nextStatus = remoteOrder.status === 'paid' ? 'paid' : remoteOrder.status;
    await updateOrder(order.razorpayOrderId, { status: nextStatus });

    res.json({
      orderId: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      status: nextStatus,
      amountPaid: remoteOrder.amount_paid,
    });
  } catch (error) {
    console.error('Razorpay order status failed:', error.message);
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function handleRazorpayWebhook(req, res) {
  if (!RAZORPAY_WEBHOOK_SECRET) return res.status(503).send('Webhook secret is not configured');

  const rawBody = req.body.toString('utf8');
  const receivedSignature = req.get('X-Razorpay-Signature');
  const expectedSignature = hmacSha256(RAZORPAY_WEBHOOK_SECRET, rawBody);

  if (!timingSafeEqualHex(expectedSignature, receivedSignature)) {
    return res.status(400).send('Invalid webhook signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).send('Invalid webhook JSON');
  }

  if (!event.id || !event.created_at) return res.status(400).send('Invalid webhook envelope');
  if (Math.abs(Date.now() / 1000 - Number(event.created_at)) > 300) {
    return res.status(400).send('Stale webhook');
  }

  if (hasEvent(event.id)) return res.status(200).send('ok');

  await saveEvent(event.id, event);
  const payload = event.payload || {};
  const payment = payload.payment?.entity;
  const order = payload.order?.entity;
  const orderId = payment?.order_id || order?.id;

  if (orderId && getOrder(orderId)) {
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      await updateOrder(orderId, {
        status: 'paid',
        paymentId: payment?.id || getOrder(orderId).paymentId,
      });
    } else if (event.event === 'payment.failed') {
      await updateOrder(orderId, {
        status: 'failed',
        paymentId: payment?.id || getOrder(orderId).paymentId,
      });
    }
  }

  return res.status(200).send('ok');
}

async function run() {
  await initRazorpayStore();

  const bundler = new Parcel({
    entries: 'index.html',
    defaultConfig: '@parcel/config-default',
    mode: 'development',
    defaultTargetOptions: {
      distDir: 'dist',
    },
  });

  await bundler.watch((err) => {
    if (err) {
      console.error('Build error:', err.diagnostics);
    } else {
      console.log('Parcel build successful');
    }
  });

  const app = express();

  // Webhook must receive the exact raw body for signature verification.
  app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), handleRazorpayWebhook);

  app.use(express.json());

  app.get('/api/razorpay/config', (req, res) => {
    res.json({
      enabled: Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET),
      keyId: RAZORPAY_KEY_ID || null,
      businessName: process.env.RAZORPAY_BUSINESS_NAME || 'WebZjs',
    });
  });
  app.post('/api/razorpay/orders', createRazorpayOrder);
  app.post('/api/razorpay/verify', verifyRazorpayPayment);
  app.get('/api/razorpay/orders/:orderId', getRazorpayOrderStatus);

  // Set custom headers (for WASM multi-threading)
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
  });

  app.use(history());
  app.use(express.static(join(__dirname, 'dist')));

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
