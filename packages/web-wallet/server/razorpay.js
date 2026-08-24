import crypto from 'crypto';

const orders = new Map();
const processedWebhookEvents = new Set();

const getKeyId = () => process.env.RAZORPAY_KEY_ID;
const getKeySecret = () => process.env.RAZORPAY_KEY_SECRET;
const getWebhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET;

function assertConfigured() {
  if (!getKeyId() || !getKeySecret()) {
    const error = new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    error.status = 503;
    throw error;
  }
}

function basicAuth() {
  assertConfigured();
  return `Basic ${Buffer.from(`${getKeyId()}:${getKeySecret()}`).toString('base64')}`;
}

async function razorpayRequest(path, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.description || `Razorpay request failed (${response.status})`);
    error.status = response.status;
    error.razorpay = body;
    throw error;
  }
  return body;
}

export function getPublicConfig() {
  const keyId = getKeyId();
  const keySecret = getKeySecret();
  return { keyId: keyId || null, enabled: Boolean(keyId && keySecret) };
}

export async function createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
  assertConfigured();
  if (!Number.isInteger(amount) || amount < 100) {
    const error = new Error('Amount must be an integer number of paise and at least ₹1.');
    error.status = 400;
    throw error;
  }

  const safeReceipt = receipt || `webzjs_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const order = await razorpayRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      currency,
      receipt: safeReceipt,
      notes,
      payment_capture: 1,
    }),
  });

  orders.set(order.id, {
    id: order.id,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    createdAt: Date.now(),
    paymentId: null,
    verified: false,
  });

  return order;
}

function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  assertConfigured();
  const expected = crypto
    .createHmac('sha256', getKeySecret())
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return timingSafeHexEqual(expected, signature);
}

export function verifyWebhookSignature(rawBody, signature) {
  const webhookSecret = getWebhookSecret();
  if (!webhookSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return timingSafeHexEqual(expected, signature);
}

export async function verifyAndFetchPayment({ orderId, paymentId, signature }) {
  const localOrder = orders.get(orderId);
  if (!localOrder) {
    const error = new Error('Unknown Razorpay order. The server did not create this order.');
    error.status = 400;
    throw error;
  }

  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    const error = new Error('Razorpay payment signature verification failed.');
    error.status = 400;
    throw error;
  }

  const payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== orderId) {
    const error = new Error('Payment does not belong to the expected Razorpay order.');
    error.status = 400;
    throw error;
  }

  localOrder.paymentId = paymentId;
  localOrder.verified = true;
  localOrder.paymentStatus = payment.status;
  localOrder.verifiedAt = Date.now();

  return {
    verified: true,
    captured: payment.status === 'captured',
    paymentId,
    orderId,
    status: payment.status,
  };
}

export function markWebhookProcessed(eventId) {
  if (!eventId) return false;
  if (processedWebhookEvents.has(eventId)) return false;
  processedWebhookEvents.add(eventId);
  return true;
}

export function processWebhookEvent(event) {
  const payment = event?.payload?.payment?.entity;
  const order = event?.payload?.order?.entity;
  const orderId = payment?.order_id || order?.id;
  if (!orderId) return;

  const localOrder = orders.get(orderId);
  if (!localOrder) return;

  if (payment) {
    localOrder.paymentId = payment.id || localOrder.paymentId;
    localOrder.paymentStatus = payment.status;
  }
  if (order) localOrder.status = order.status;
  localOrder.lastWebhookEvent = event.event;
  localOrder.updatedAt = Date.now();
}

export function getLocalOrder(orderId) {
  return orders.get(orderId) || null;
}
