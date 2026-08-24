import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

let storePath;
let store = { orders: {}, events: {} };
let writeQueue = Promise.resolve();

function getStorePath() {
  return storePath || process.env.RAZORPAY_STORE_PATH || join(process.cwd(), 'data', 'razorpay.json');
}

async function ensureStore() {
  storePath = getStorePath();
  await mkdir(dirname(storePath), { recursive: true });
  try {
    store = JSON.parse(await readFile(storePath, 'utf8'));
    store.orders ||= {};
    store.events ||= {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persist();
  }
}

async function persist() {
  const path = getStorePath();
  const next = `${path}.tmp`;
  await writeFile(next, JSON.stringify(store, null, 2), 'utf8');
  await rename(next, path);
}

function enqueuePersist() {
  writeQueue = writeQueue.then(persist, persist);
  return writeQueue;
}

export async function initRazorpayStore() {
  await ensureStore();
}

export function getOrder(orderId) {
  return store.orders[orderId] || null;
}

export async function saveOrder(order) {
  store.orders[order.razorpayOrderId] = order;
  await enqueuePersist();
  return order;
}

export async function updateOrder(orderId, patch) {
  const current = getOrder(orderId);
  if (!current) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  store.orders[orderId] = next;
  await enqueuePersist();
  return next;
}

export function hasEvent(eventId) {
  return Boolean(store.events[eventId]);
}

export async function saveEvent(eventId, event) {
  store.events[eventId] = {
    receivedAt: new Date().toISOString(),
    event,
  };
  await enqueuePersist();
}
