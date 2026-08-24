import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Parcel } from '@parcel/core';
import history from 'connect-history-api-fallback';
import dotenv from 'dotenv';
import {
  createOrder,
  getLocalOrder,
  getPublicConfig,
  markWebhookProcessed,
  processWebhookEvent,
  verifyAndFetchPayment,
  verifyWebhookSignature,
} from './server/razorpay.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function run() {
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

  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
  });

  // Razorpay webhooks must receive the raw request body for HMAC validation.
  app.post('/api/razorpay/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    const signature = req.get('x-razorpay-signature');
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ ok: false, error: 'Invalid Razorpay webhook signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid webhook JSON' });
    }

    if (!markWebhookProcessed(event?.id)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    // Acknowledge quickly; heavier processing can move to a queue later.
    res.status(200).json({ ok: true });
    queueMicrotask(() => processWebhookEvent(event));
  });

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/razorpay/config', (_req, res) => {
    res.json(getPublicConfig());
  });

  app.post('/api/razorpay/orders', async (req, res) => {
    try {
      const { amount, currency = 'INR', receipt, notes = {} } = req.body || {};
      const order = await createOrder({ amount, currency, receipt, notes });
      res.status(201).json({
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        receipt: order.receipt,
      });
    } catch (error) {
      console.error('Razorpay order creation failed:', error.message);
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.post('/api/razorpay/verify', async (req, res) => {
    try {
      const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
      if (!orderId || !paymentId || !signature) {
        return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });
      }

      const result = await verifyAndFetchPayment({ orderId, paymentId, signature });
      res.json(result);
    } catch (error) {
      console.error('Razorpay payment verification failed:', error.message);
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.get('/api/razorpay/orders/:orderId', (req, res) => {
    const order = getLocalOrder(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
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
