import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type PaymentChannel = "alipay" | "wechat";
type StoreOrderStatus = "created" | "pending" | "paid" | "notified" | "expired" | "failed";

interface Product {
  id: string;
  name: string;
  description: string;
  price: string;
  channel: PaymentChannel;
}

interface PeerPayOrder {
  id: string;
  merchantOrderId: string | null;
  paymentChannel: PaymentChannel;
  requestedAmount: string;
  actualAmount: string;
  payUrl: string;
  payMode: "preset" | "fallback";
  amountInputRequired: boolean;
  status: "pending" | "paid" | "notified" | "expired";
  subject: string | null;
  expireAt: string;
  createdAt: string;
}

interface ApiErrorPayload {
  error?: string;
}

interface StoreOrder {
  id: string;
  productId: string;
  productName: string;
  amount: string;
  paymentChannel: PaymentChannel;
  status: StoreOrderStatus;
  peerpayOrderId: string | null;
  peerpayStatus: PeerPayOrder["status"] | null;
  actualAmount: string | null;
  payUrl: string | null;
  amountInputRequired: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

const products: Product[] = [
  { id: "sticker-pack", name: "贴纸包", description: "三张随机开发者贴纸", price: "1.00", channel: "alipay" },
  { id: "emoji-keycap", name: "表情键帽", description: "单颗彩色体验键帽", price: "2.00", channel: "wechat" },
  { id: "coffee-coupon", name: "咖啡券", description: "测试用小额咖啡抵扣券", price: "1.00", channel: "alipay" },
  { id: "cable-tie", name: "理线扎带", description: "一条柔软硅胶理线带", price: "3.00", channel: "wechat" }
];

const databaseUrl = Bun.env.STORE_DATABASE_URL ?? "./data/store.sqlite";
if (databaseUrl !== ":memory:") {
  mkdirSync(dirname(databaseUrl), { recursive: true });
}

const db = new Database(databaseUrl);
db.exec(`
  CREATE TABLE IF NOT EXISTS store_orders (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    amount TEXT NOT NULL,
    payment_channel TEXT NOT NULL,
    status TEXT NOT NULL,
    peerpay_order_id TEXT,
    peerpay_status TEXT,
    actual_amount TEXT,
    pay_url TEXT,
    amount_input_required INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json({ data }, {
    ...init,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-peerpay-signature",
      ...init.headers
    }
  });
}

function error(message: string, status = 400) {
  return json({ error: message }, { status });
}

function nowIso() {
  return new Date().toISOString();
}

function createStoreOrderId() {
  return `store_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

function peerpayBaseUrl() {
  return (Bun.env.PEERPAY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function publicBaseUrl(req: Request) {
  return (Bun.env.STORE_PUBLIC_URL ?? new URL(req.url).origin).replace(/\/$/, "");
}

function mapOrder(row: Record<string, unknown>): StoreOrder {
  return {
    id: String(row.id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    amount: String(row.amount),
    paymentChannel: row.payment_channel as PaymentChannel,
    status: row.status as StoreOrderStatus,
    peerpayOrderId: row.peerpay_order_id ? String(row.peerpay_order_id) : null,
    peerpayStatus: row.peerpay_status ? row.peerpay_status as PeerPayOrder["status"] : null,
    actualAmount: row.actual_amount ? String(row.actual_amount) : null,
    payUrl: row.pay_url ? String(row.pay_url) : null,
    amountInputRequired: row.amount_input_required === 1,
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function getStoreOrder(id: string) {
  const row = db.query("SELECT * FROM store_orders WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? mapOrder(row) : null;
}

async function readJson<T>(req: Request) {
  return await req.json().catch(() => ({})) as T;
}

async function createOrder(req: Request) {
  const body = await readJson<{ productId?: string }>(req);
  const product = products.find((item) => item.id === body.productId);
  if (!product) {
    return error("商品不存在", 404);
  }

  const id = createStoreOrderId();
  const createdAt = nowIso();
  db.query(`
    INSERT INTO store_orders (
      id, product_id, product_name, amount, payment_channel, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, product.id, product.name, product.price, product.channel, "created", createdAt, createdAt);

  try {
    const response = await fetch(`${peerpayBaseUrl()}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: product.price,
        paymentChannel: product.channel,
        merchantOrderId: id,
        subject: product.name,
        callbackUrl: `${publicBaseUrl(req)}/api/peerpay/callback`
      })
    });
    const payload = await response.json().catch(() => ({})) as { data?: PeerPayOrder | { error?: string }; error?: string };

    if (!response.ok || !payload.data || isApiErrorPayload(payload.data)) {
      const detail = isApiErrorPayload(payload.data) ? payload.data.error : undefined;
      throw new Error(detail ?? payload.error ?? `PeerPay 创建订单失败 (${response.status})`);
    }

    const order = payload.data;
    db.query(`
      UPDATE store_orders
      SET status = ?, peerpay_order_id = ?, peerpay_status = ?, actual_amount = ?, pay_url = ?,
          amount_input_required = ?, error = NULL, updated_at = ?
      WHERE id = ?
    `).run("pending", order.id, order.status, order.actualAmount, order.payUrl, order.amountInputRequired ? 1 : 0, nowIso(), id);
  } catch (err) {
    db.query("UPDATE store_orders SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run("failed", err instanceof Error ? err.message : "创建订单失败", nowIso(), id);
  }

  return json(getStoreOrder(id), { status: 201 });
}

async function handlePeerPayCallback(req: Request) {
  const body = await readJson<{
    merchantOrderId?: string;
    orderId?: string;
    id?: string;
    status?: StoreOrderStatus;
    actualAmount?: string;
    paidAt?: string;
  }>(req);
  const storeOrderId = body.merchantOrderId;
  if (!storeOrderId) {
    return error("缺少 merchantOrderId", 400);
  }

  const nextStatus = body.status === "notified" ? "notified" : body.status === "paid" ? "paid" : body.status === "expired" ? "expired" : "pending";
  db.query(`
    UPDATE store_orders
    SET status = ?, peerpay_status = ?, actual_amount = COALESCE(?, actual_amount), updated_at = ?
    WHERE id = ?
  `).run(nextStatus, body.status ?? null, body.actualAmount ?? null, nowIso(), storeOrderId);

  const order = getStoreOrder(storeOrderId);
  if (!order) {
    return error("店铺订单不存在", 404);
  }
  return json({ ok: true, order });
}

function listOrders() {
  const rows = db.query("SELECT * FROM store_orders ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[];
  return rows.map(mapOrder);
}

function route(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: json({}).headers });
  }

  const url = new URL(req.url);
  if (url.pathname === "/api/products" && req.method === "GET") {
    return json(products);
  }
  if (url.pathname === "/api/orders" && req.method === "GET") {
    return json(listOrders());
  }
  if (url.pathname === "/api/orders" && req.method === "POST") {
    return createOrder(req);
  }
  const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "GET") {
    const order = getStoreOrder(orderMatch[1]);
    return order ? json(order) : error("订单不存在", 404);
  }
  if (url.pathname === "/api/peerpay/callback" && req.method === "POST") {
    return handlePeerPayCallback(req);
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    return json({ ok: true, peerpayBaseUrl: peerpayBaseUrl(), time: nowIso() });
  }
  if (url.pathname.startsWith("/api/")) {
    return error("接口不存在", 404);
  }

  return new Response(Bun.file("./public/index.html"), {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

const port = Number(Bun.env.PORT ?? 5174);
const server = Bun.serve({
  port,
  development: Bun.env.NODE_ENV !== "production",
  fetch: route
});

console.log(`PeerPay mock store listening on ${server.url}`);
console.log(`PeerPay base URL: ${peerpayBaseUrl()}`);
