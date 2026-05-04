import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createDatabase } from "./db";
import { DEFAULT_LOOKUP_METHODS, PAYMENT_CHANNEL_LABELS } from "../src/shared/constants";
import type {
  AddCardsInput,
  ContactType,
  CreateOrderInput,
  CreateOrderResult,
  CreateProductInput,
  DashboardStats,
  DeliveryMode,
  LogLevel,
  Order,
  OrderStatus,
  Page,
  PaymentChannel,
  PickupOpenMode,
  Product,
  ProductCard,
  ProductStatus,
  PublicProduct,
  StoreAd,
  StoreSettings,
  SystemLog,
  UpdateProductInput,
  UpstreamConfig,
  UpstreamHttpRequest,
  UpstreamOrderRequest,
  UpstreamStockRequest
} from "../src/shared/types";

export interface AppContext {
  db: Database;
}

type ApiError = Error & { status?: number };
type SqlBinding = string | number | bigint | boolean | null | Uint8Array;

interface ProductRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  price_cents: number;
  status: ProductStatus;
  cover_url: string | null;
  sort_order: number;
  delivery_mode: DeliveryMode;
  pickup_url: string | null;
  pickup_open_mode: PickupOpenMode;
  lookup_methods: string;
  upstream_config: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderRow {
  id: string;
  product_id: number;
  product_slug: string;
  product_title: string;
  amount_cents: number;
  contact_type: ContactType;
  contact_value: string;
  remark: string | null;
  status: OrderStatus;
  peerpay_order_id: string | null;
  peerpay_pay_url: string | null;
  peerpay_actual_amount_cents: number | null;
  peerpay_payment_channel: PaymentChannel | null;
  peerpay_callback_secret: string | null;
  delivery_mode: DeliveryMode;
  delivery_payload: string | null;
  pickup_url: string | null;
  pickup_open_mode: PickupOpenMode;
  upstream_order_id: string | null;
  upstream_response: string | null;
  manual_reason: string | null;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
  updated_at: string;
}

interface ProductCardRow {
  id: number;
  product_id: number;
  secret: string;
  status: "available" | "delivered";
  order_id: string | null;
  created_at: string;
  delivered_at: string | null;
}

interface SystemLogRow {
  id: number;
  level: LogLevel;
  action: string;
  message: string;
  context: string | null;
  created_at: string;
}

interface RequestResult {
  ok: boolean;
  status: number;
  data: unknown;
  text: string;
}

interface Availability {
  available: boolean;
  reason: string | null;
}

interface PeerPayCreateOrderResponse {
  id: string;
  payUrl: string;
  actualAmount?: string;
  actualAmountCents?: number;
  paymentChannel?: PaymentChannel;
}

interface PeerPayCallbackPayload {
  orderId?: string;
  merchantOrderId?: string | null;
  paymentAccountCode?: string;
  paymentChannel?: PaymentChannel;
  status?: string;
  requestedAmount?: string;
  actualAmount?: string;
  paidAt?: string;
  sign?: string;
}

const UPLOAD_DIR = join(process.cwd(), "data", "uploads");
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

export function createAppContext(): AppContext {
  const ctx = { db: createDatabase() };
  ensureStoreSettings(ctx);
  return ctx;
}

export function apiError(status: number, message: string) {
  const error = new Error(message) as ApiError;
  error.status = status;
  return error;
}

export function nowIso() {
  return new Date().toISOString();
}

export function getSetting(ctx: AppContext, key: string) {
  const row = ctx.db.query("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(ctx: AppContext, key: string, value: string, updatedAt = nowIso()) {
  ctx.db.query(`
    INSERT INTO app_settings(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, updatedAt);
}

function ensureStoreSettings(ctx: AppContext) {
  const at = nowIso();
  const defaults: Array<[string, string]> = [
    ["peerpay_base_url", ""],
    ["store_base_url", ""],
    ["peerpay_payment_channel", "alipay"],
    ["peerpay_ttl_minutes", "15"]
  ];
  for (const [key, value] of defaults) {
    if (getSetting(ctx, key) === null) {
      setSetting(ctx, key, value, at);
    }
  }
}

export function getStoreSettings(ctx: AppContext): StoreSettings {
  return {
    feishuWebhookUrl: blankToNull(getSetting(ctx, "feishu_webhook_url")),
    storeName: getSetting(ctx, "store_name") ?? "PeerPay Store",
    storeNotice: getSetting(ctx, "store_notice") ?? "自动发货和自助提货的轻量开源店铺。",
    ads: parseJson<StoreAd[]>(getSetting(ctx, "store_ads"), []),
    peerpayBaseUrl: blankToNull(getSetting(ctx, "peerpay_base_url")),
    storeBaseUrl: blankToNull(getSetting(ctx, "store_base_url")),
    peerpayPaymentChannel: normalizePaymentChannel(getSetting(ctx, "peerpay_payment_channel") ?? "alipay"),
    peerpayTtlMinutes: clampNumber(Number(getSetting(ctx, "peerpay_ttl_minutes") ?? 15), 1, 1440)
  };
}

export function updateStoreSettings(ctx: AppContext, input: Partial<StoreSettings>) {
  const at = nowIso();
  if ("feishuWebhookUrl" in input) {
    setSetting(ctx, "feishu_webhook_url", input.feishuWebhookUrl?.trim() ?? "", at);
  }
  if ("storeName" in input) {
    setSetting(ctx, "store_name", input.storeName?.trim() || "PeerPay Store", at);
  }
  if ("storeNotice" in input) {
    setSetting(ctx, "store_notice", input.storeNotice?.trim() ?? "", at);
  }
  if ("ads" in input) {
    setSetting(ctx, "store_ads", JSON.stringify(normalizeStoreAds(input.ads ?? [])), at);
  }
  if ("peerpayBaseUrl" in input) {
    setSetting(ctx, "peerpay_base_url", input.peerpayBaseUrl?.trim() ?? "", at);
  }
  if ("storeBaseUrl" in input) {
    setSetting(ctx, "store_base_url", input.storeBaseUrl?.trim() ?? "", at);
  }
  if ("peerpayPaymentChannel" in input) {
    setSetting(ctx, "peerpay_payment_channel", normalizePaymentChannel(input.peerpayPaymentChannel).trim(), at);
  }
  if ("peerpayTtlMinutes" in input) {
    setSetting(ctx, "peerpay_ttl_minutes", String(clampNumber(Number(input.peerpayTtlMinutes ?? 15), 1, 1440)), at);
  }
  return getStoreSettings(ctx);
}

export async function saveUploadedImage(file: FormDataEntryValue | null) {
  if (!(file instanceof File)) {
    throw apiError(400, "请选择要上传的图片");
  }
  const extension = IMAGE_MIME_EXTENSIONS[file.type];
  if (!extension) {
    throw apiError(400, "仅支持 PNG、JPG、WEBP 或 GIF 图片");
  }
  if (file.size > 4 * 1024 * 1024) {
    throw apiError(400, "图片不能超过 4MB");
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const fileName = `${Date.now()}-${randomBytes(8).toString("hex")}${extension}`;
  await Bun.write(join(UPLOAD_DIR, fileName), file);
  return { url: `/uploads/${fileName}`, fileName };
}

export async function uploadedImageResponse(fileName: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    throw apiError(404, "文件不存在");
  }
  const file = Bun.file(join(UPLOAD_DIR, fileName));
  if (!(await file.exists())) {
    throw apiError(404, "文件不存在");
  }
  return new Response(file, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": file.type || "application/octet-stream"
    }
  });
}

export function dashboardStats(ctx: AppContext): DashboardStats {
  const products = ctx.db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
    FROM products
  `).get() as { total: number; active: number | null };
  const cardStock = ctx.db.query("SELECT COUNT(*) AS count FROM product_cards WHERE status = 'available'").get() as { count: number };
  const orders = ctx.db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status = 'needs_manual' THEN 1 ELSE 0 END) AS needsManual,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today
    FROM orders
  `).get(startOfTodayIso()) as { total: number; delivered: number | null; needsManual: number | null; today: number | null };

  return {
    products: {
      total: products.total,
      active: products.active ?? 0,
      cardStock: cardStock.count
    },
    orders: {
      total: orders.total,
      delivered: orders.delivered ?? 0,
      needsManual: orders.needsManual ?? 0,
      today: orders.today ?? 0
    }
  };
}

export function listProducts(ctx: AppContext) {
  const rows = ctx.db.query("SELECT * FROM products ORDER BY sort_order ASC, id DESC").all() as ProductRow[];
  return rows.map((row) => productFromRow(ctx, row));
}

export async function listPublicProducts(ctx: AppContext) {
  const rows = ctx.db.query(`
    SELECT * FROM products
    WHERE status = 'active'
    ORDER BY sort_order ASC, id DESC
  `).all() as ProductRow[];

  const products: PublicProduct[] = [];
  for (const row of rows) {
    const product = productFromRow(ctx, row);
    const availability = await getProductAvailability(product);
    products.push({ ...product, available: availability.available, availabilityReason: availability.reason });
  }
  return products;
}

export async function getPublicProduct(ctx: AppContext, slug: string) {
  const row = ctx.db.query("SELECT * FROM products WHERE slug = ? AND status = 'active'").get(slug) as ProductRow | null;
  if (!row) {
    return null;
  }
  const product = productFromRow(ctx, row);
  const availability = await getProductAvailability(product);
  return { ...product, available: availability.available, availabilityReason: availability.reason };
}

export function createProduct(ctx: AppContext, input: CreateProductInput) {
  const normalized = normalizeProductInput(input);
  const at = nowIso();
  const result = ctx.db.query(`
    INSERT INTO products (
      slug, title, description, price_cents, status, cover_url, sort_order,
      delivery_mode, pickup_url, pickup_open_mode, lookup_methods, upstream_config,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.slug,
    normalized.title,
    normalized.description,
    normalized.priceCents,
    normalized.status,
    normalized.coverUrl,
    normalized.sortOrder,
    normalized.deliveryMode,
    normalized.pickupUrl,
    normalized.pickupOpenMode,
    JSON.stringify(normalized.lookupMethods),
    normalized.upstreamConfig ? JSON.stringify(normalized.upstreamConfig) : null,
    at,
    at
  );
  writeLog(ctx, "info", "product.create", `商品 ${normalized.title} 已创建`, { id: Number(result.lastInsertRowid) });
  return getProductById(ctx, Number(result.lastInsertRowid));
}

export function updateProduct(ctx: AppContext, id: number, input: UpdateProductInput) {
  const current = getProductById(ctx, id);
  if (!current) {
    throw apiError(404, "商品不存在");
  }
  const merged = normalizeProductInput({
    ...current,
    ...input,
    price: input.price ?? current.price,
    lookupMethods: input.lookupMethods ?? current.lookupMethods,
    upstreamConfig: input.upstreamConfig === undefined ? current.upstreamConfig : input.upstreamConfig
  });
  const at = nowIso();
  ctx.db.query(`
    UPDATE products
    SET slug = ?, title = ?, description = ?, price_cents = ?, status = ?, cover_url = ?,
        sort_order = ?, delivery_mode = ?, pickup_url = ?, pickup_open_mode = ?,
        lookup_methods = ?, upstream_config = ?, updated_at = ?
    WHERE id = ?
  `).run(
    merged.slug,
    merged.title,
    merged.description,
    merged.priceCents,
    merged.status,
    merged.coverUrl,
    merged.sortOrder,
    merged.deliveryMode,
    merged.pickupUrl,
    merged.pickupOpenMode,
    JSON.stringify(merged.lookupMethods),
    merged.upstreamConfig ? JSON.stringify(merged.upstreamConfig) : null,
    at,
    id
  );
  writeLog(ctx, "info", "product.update", `商品 ${merged.title} 已更新`, { id });
  return getProductById(ctx, id);
}

export function setProductStatus(ctx: AppContext, id: number, status: ProductStatus) {
  if (!["draft", "active", "archived"].includes(status)) {
    throw apiError(400, "商品状态不合法");
  }
  const product = getProductById(ctx, id);
  if (!product) {
    throw apiError(404, "商品不存在");
  }
  ctx.db.query("UPDATE products SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
  writeLog(ctx, "info", "product.status", `商品 ${product.title} 状态变更为 ${status}`, { id, status });
  return getProductById(ctx, id);
}

export function getProductById(ctx: AppContext, id: number) {
  const row = ctx.db.query("SELECT * FROM products WHERE id = ?").get(id) as ProductRow | null;
  return row ? productFromRow(ctx, row) : null;
}

export function addCards(ctx: AppContext, productId: number, input: AddCardsInput) {
  const product = getProductById(ctx, productId);
  if (!product) {
    throw apiError(404, "商品不存在");
  }
  const cards = normalizeCards(input.cards);
  if (!cards.length) {
    throw apiError(400, "请输入至少一条卡密");
  }
  const at = nowIso();
  const insert = ctx.db.query("INSERT INTO product_cards(product_id, secret, status, created_at) VALUES (?, ?, 'available', ?)");
  for (const card of cards) {
    insert.run(productId, card, at);
  }
  writeLog(ctx, "info", "cards.add", `商品 ${product.title} 新增 ${cards.length} 条卡密`, { productId, count: cards.length });
  return { saved: cards.length, availableStock: countCards(ctx, productId) };
}

export function listCards(ctx: AppContext, productId: number): ProductCard[] {
  const rows = ctx.db.query("SELECT * FROM product_cards WHERE product_id = ? ORDER BY id DESC LIMIT 200").all(productId) as ProductCardRow[];
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    status: row.status,
    secretPreview: maskSecret(row.secret),
    orderId: row.order_id,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at
  }));
}

export async function createOrder(ctx: AppContext, input: CreateOrderInput, requestUrl?: string): Promise<CreateOrderResult> {
  const product = getOrderProduct(ctx, input);
  if (!product || product.status !== "active") {
    throw apiError(404, "商品不存在或未上架");
  }
  const contactValue = normalizeContact(input.contactValue);
  const contactType = detectContactType(contactValue);
  const paymentChannel = normalizeOrderPaymentChannel(input.paymentChannel);
  const remark = normalizeOrderRemark(input.remark);
  const availability = await getProductAvailability(product);
  if (!availability.available) {
    throw apiError(409, availability.reason ?? "商品暂无库存");
  }

  const order = insertOrder(ctx, product, contactType, contactValue, paymentChannel, remark);
  try {
    const paidOrder = await createPeerPayPayment(ctx, order, product, requestUrl);
    return { order: paidOrder, paymentUrl: paidOrder.peerpayPayUrl, rememberedAt: nowIso() };
  } catch (error) {
    const failed = updateOrderManual(ctx, order.id, error instanceof Error ? error.message : "PeerPay 支付订单创建失败");
    await notifyFeishu(ctx, "PeerPay Store 支付订单创建失败", formatOrderNotice(failed));
    throw apiError(502, failed.manualReason ?? "PeerPay 支付订单创建失败");
  }
}

export function getOrder(ctx: AppContext, id: string) {
  const row = ctx.db.query("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | null;
  return row ? orderFromRow(row) : null;
}

export function listOrders(ctx: AppContext, options: { limit: number; offset: number; status?: string | null }) {
  const where: string[] = [];
  const params: SqlBinding[] = [];
  if (options.status) {
    where.push("status = ?");
    params.push(options.status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = ctx.db.query(`SELECT COUNT(*) AS count FROM orders ${whereSql}`).get(...params) as { count: number };
  const rows = ctx.db.query(`
    SELECT * FROM orders
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, options.limit, options.offset) as OrderRow[];
  return { items: rows.map(orderFromRow), total: total.count, limit: options.limit, offset: options.offset };
}

export function findOrdersByContact(ctx: AppContext, contactValue: string): Order[] {
  const normalized = normalizeContact(contactValue);
  const rows = ctx.db.query(`
    SELECT * FROM orders
    WHERE contact_value = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(normalized) as OrderRow[];
  return rows.map(orderFromRow);
}

export function updateOrderStatus(ctx: AppContext, id: string, status: OrderStatus, manualReason?: string) {
  if (!["pending_payment", "paid", "delivered", "needs_manual", "failed", "cancelled"].includes(status)) {
    throw apiError(400, "订单状态不合法");
  }
  const order = getOrder(ctx, id);
  if (!order) {
    throw apiError(404, "订单不存在");
  }
  const at = nowIso();
  ctx.db.query(`
    UPDATE orders
    SET status = ?, manual_reason = COALESCE(?, manual_reason),
        delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE delivered_at END,
        updated_at = ?
    WHERE id = ?
  `).run(status, manualReason ?? null, status, at, at, id);
  writeLog(ctx, status === "needs_manual" ? "warn" : "info", "order.status", `订单 ${id} 状态变更为 ${status}`, { id, status, manualReason });
  return getOrder(ctx, id);
}

export function listSystemLogs(ctx: AppContext, options: { limit: number; offset: number; level?: string | null }): Page<SystemLog> {
  const where: string[] = [];
  const params: SqlBinding[] = [];
  if (options.level) {
    where.push("level = ?");
    params.push(options.level);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = ctx.db.query(`SELECT COUNT(*) AS count FROM system_logs ${whereSql}`).get(...params) as { count: number };
  const rows = ctx.db.query(`
    SELECT * FROM system_logs
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, options.limit, options.offset) as SystemLogRow[];
  return { items: rows.map(logFromRow), total: total.count, limit: options.limit, offset: options.offset };
}

export function writeLog(ctx: AppContext, level: LogLevel, action: string, message: string, context?: unknown) {
  ctx.db.query(`
    INSERT INTO system_logs(level, action, message, context, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(level, action, message, context === undefined ? null : JSON.stringify(context), nowIso());
}

export async function handlePeerPayCallback(ctx: AppContext, payload: PeerPayCallbackPayload, headerSign: string | null) {
  const orderId = payload.merchantOrderId || payload.orderId;
  if (!orderId) {
    throw apiError(400, "PeerPay 回调缺少订单号");
  }
  const order = getOrder(ctx, orderId);
  if (!order) {
    throw apiError(404, "业务订单不存在");
  }
  const secret = getOrderCallbackSecret(ctx, order.id);
  if (!secret || !verifyPeerPayCallback(payload, headerSign ?? "", secret)) {
    throw apiError(401, "PeerPay 回调签名无效");
  }
  if (payload.status !== "paid") {
    throw apiError(400, "PeerPay 回调状态不是 paid");
  }
  if (payload.orderId && order.peerpayOrderId && payload.orderId !== order.peerpayOrderId) {
    throw apiError(400, "PeerPay 订单号不匹配");
  }
  if (payload.requestedAmount && parseMoney(payload.requestedAmount) !== order.amountCents) {
    throw apiError(400, "PeerPay 回调金额不匹配");
  }

  const paidAt = payload.paidAt || nowIso();
  ctx.db.query(`
    UPDATE orders
    SET status = CASE WHEN status = 'pending_payment' THEN 'paid' ELSE status END,
        peerpay_order_id = COALESCE(peerpay_order_id, ?),
        peerpay_actual_amount_cents = COALESCE(peerpay_actual_amount_cents, ?),
        peerpay_payment_channel = COALESCE(peerpay_payment_channel, ?),
        paid_at = COALESCE(paid_at, ?),
        updated_at = ?
    WHERE id = ?
  `).run(
    payload.orderId ?? null,
    payload.actualAmount ? parseMoney(payload.actualAmount) : null,
    payload.paymentChannel ?? null,
    paidAt,
    nowIso(),
    order.id
  );

  const updated = getOrder(ctx, order.id);
  if (!updated) {
    throw apiError(500, "订单更新失败");
  }
  writeLog(ctx, "info", "peerpay.callback", `订单 ${order.id} 已收到 PeerPay 支付回调`, { orderId: order.id, peerpayOrderId: payload.orderId });
  const delivered = await fulfillPaidOrder(ctx, updated);
  return { ok: true, order: delivered };
}

async function createPeerPayPayment(ctx: AppContext, order: Order, product: Product, requestUrl?: string) {
  const settings = getStoreSettings(ctx);
  if (!settings.peerpayBaseUrl) {
    throw new Error("未配置 PeerPay 服务地址");
  }
  const publicBase = settings.storeBaseUrl || (requestUrl ? new URL(requestUrl).origin : "");
  if (!publicBase) {
    throw new Error("无法生成 PeerPay 回调地址，请配置 Store 公开访问地址");
  }

  const callbackSecret = randomBytes(32).toString("hex");
  const callbackUrl = new URL("/api/payments/peerpay/callback", publicBase).toString();
  const redirectUrl = new URL(`/orders/${order.id}`, publicBase).toString();
  const peerpayUrl = new URL("/api/orders", settings.peerpayBaseUrl).toString();
  const paymentChannel = order.peerpayPaymentChannel ?? settings.peerpayPaymentChannel;
  const response = await fetch(peerpayUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paymentChannel,
      amount: order.amount,
      merchantOrderId: order.id,
      subject: product.title,
      callbackUrl,
      callbackSecret,
      redirectUrl,
      ttlMinutes: settings.peerpayTtlMinutes
    })
  });
  const envelope = await response.json().catch(() => ({})) as { data?: PeerPayCreateOrderResponse & { error?: string } };
  if (!response.ok || !envelope.data?.id || !envelope.data.payUrl) {
    throw new Error(envelope.data?.error || `PeerPay HTTP ${response.status}`);
  }

  const data = envelope.data;
  ctx.db.query(`
    UPDATE orders
    SET peerpay_order_id = ?, peerpay_pay_url = ?, peerpay_actual_amount_cents = ?,
        peerpay_payment_channel = ?, peerpay_callback_secret = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.id,
    data.payUrl,
    data.actualAmountCents ?? (data.actualAmount ? parseMoney(data.actualAmount) : null),
    data.paymentChannel ?? paymentChannel,
    callbackSecret,
    nowIso(),
    order.id
  );
  writeLog(ctx, "info", "peerpay.create", `订单 ${order.id} 已创建 PeerPay 支付单`, { orderId: order.id, peerpayOrderId: data.id });
  const updated = getOrder(ctx, order.id);
  if (!updated) {
    throw new Error("PeerPay 支付单保存失败");
  }
  return updated;
}

async function fulfillPaidOrder(ctx: AppContext, order: Order) {
  if (order.status === "delivered" || order.status === "needs_manual" || order.status === "cancelled") {
    return order;
  }
  const product = getProductById(ctx, order.productId);
  if (!product) {
    const manual = updateOrderManual(ctx, order.id, "支付成功后商品不存在");
    await notifyFeishu(ctx, "PeerPay Store 支付后发货失败", formatOrderNotice(manual));
    return manual;
  }
  if (product.deliveryMode === "card") {
    return fulfillCardOrder(ctx, order);
  }
  if (product.deliveryMode === "upstream") {
    return fulfillUpstreamOrder(ctx, order, product);
  }
  const manual = updateOrderManual(ctx, order.id, "商品配置为人工处理");
  await notifyFeishu(ctx, "PeerPay Store 人工处理订单", formatOrderNotice(manual));
  return manual;
}

async function fulfillUpstreamOrder(ctx: AppContext, order: Order, product: Product) {
  const config = product.upstreamConfig;
  const request = config?.order;
  if (!config || !request?.enabled || !request.url) {
    const manual = updateOrderManual(ctx, order.id, "未配置可用的上游下单请求");
    await notifyFeishu(ctx, "PeerPay Store 上游下单未配置", formatOrderNotice(manual));
    return manual;
  }

  const vars = orderTemplateVars(product, order);
  try {
    const result = await runRequest(request, vars);
    if (!result.ok) {
      throw new Error(`上游 HTTP ${result.status}`);
    }

    const success = checkOrderSuccess(request, result.data);
    const remoteOrderId = stringifyValue(request.remoteOrderIdPath ? getPath(result.data, request.remoteOrderIdPath) : null);
    const delivery = stringifyValue(request.deliveryPath ? getPath(result.data, request.deliveryPath) : null)
      ?? remoteOrderId
      ?? "上游已接单，请按提货信息继续处理";

    if (!success) {
      const manual = updateOrderManual(ctx, order.id, "上游下单返回与成功条件不一致", result, remoteOrderId);
      await notifyFeishu(ctx, "PeerPay Store 上游返回不一致", formatOrderNotice(manual));
      return manual;
    }

    const delivered = updateOrderDelivered(ctx, order.id, delivery, result, remoteOrderId);
    writeLog(ctx, "info", "order.upstream.delivered", `订单 ${order.id} 上游自动发货成功`, { orderId: order.id, remoteOrderId });
    return delivered;
  } catch (error) {
    const manual = updateOrderManual(ctx, order.id, error instanceof Error ? error.message : "上游下单请求失败");
    await notifyFeishu(ctx, "PeerPay Store 上游下单失败", formatOrderNotice(manual));
    return manual;
  }
}

function fulfillCardOrder(ctx: AppContext, order: Order) {
  const card = ctx.db.query(`
    SELECT * FROM product_cards
    WHERE product_id = ? AND status = 'available'
    ORDER BY id ASC
    LIMIT 1
  `).get(order.productId) as ProductCardRow | null;
  if (!card) {
    const manual = updateOrderManual(ctx, order.id, "卡密库存不足");
    void notifyFeishu(ctx, "PeerPay Store 卡密库存不足", formatOrderNotice(manual));
    return manual;
  }
  const at = nowIso();
  ctx.db.query(`
    UPDATE product_cards
    SET status = 'delivered', order_id = ?, delivered_at = ?
    WHERE id = ? AND status = 'available'
  `).run(order.id, at, card.id);
  const delivered = updateOrderDelivered(ctx, order.id, card.secret, null, null, at);
  writeLog(ctx, "info", "order.card.delivered", `订单 ${order.id} 卡密自动发货`, { orderId: order.id, cardId: card.id });
  return delivered;
}

function insertOrder(ctx: AppContext, product: Product, contactType: ContactType, contactValue: string, paymentChannel: PaymentChannel, remark: string | null) {
  const id = createOrderId();
  const at = nowIso();
  ctx.db.query(`
    INSERT INTO orders (
      id, product_id, product_slug, product_title, amount_cents, contact_type,
      contact_value, remark, status, peerpay_payment_channel, delivery_mode, pickup_url, pickup_open_mode,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    product.id,
    product.slug,
    product.title,
    product.priceCents,
    contactType,
    contactValue,
    remark,
    paymentChannel,
    product.deliveryMode,
    product.pickupUrl,
    product.pickupOpenMode,
    at,
    at
  );
  writeLog(ctx, "info", "order.create", `订单 ${id} 已创建`, { orderId: id, productId: product.id, paymentChannel, remark });
  const order = getOrder(ctx, id);
  if (!order) {
    throw apiError(500, "订单创建失败");
  }
  return order;
}

function updateOrderDelivered(ctx: AppContext, id: string, deliveryPayload: string, upstreamResponse: unknown, upstreamOrderId: string | null, deliveredAt = nowIso()) {
  ctx.db.query(`
    UPDATE orders
    SET status = 'delivered', delivery_payload = ?, upstream_response = ?, upstream_order_id = ?,
        manual_reason = NULL, delivered_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    deliveryPayload,
    upstreamResponse === undefined || upstreamResponse === null ? null : JSON.stringify(upstreamResponse),
    upstreamOrderId,
    deliveredAt,
    deliveredAt,
    id
  );
  const order = getOrder(ctx, id);
  if (!order) {
    throw apiError(500, "订单更新失败");
  }
  return order;
}

function updateOrderManual(ctx: AppContext, id: string, manualReason: string, upstreamResponse?: unknown, upstreamOrderId?: string | null) {
  const at = nowIso();
  ctx.db.query(`
    UPDATE orders
    SET status = 'needs_manual', manual_reason = ?, upstream_response = COALESCE(?, upstream_response),
        upstream_order_id = COALESCE(?, upstream_order_id), updated_at = ?
    WHERE id = ?
  `).run(
    manualReason,
    upstreamResponse === undefined ? null : JSON.stringify(upstreamResponse),
    upstreamOrderId ?? null,
    at,
    id
  );
  writeLog(ctx, "warn", "order.manual", `订单 ${id} 需要人工介入`, { orderId: id, manualReason });
  const order = getOrder(ctx, id);
  if (!order) {
    throw apiError(500, "订单更新失败");
  }
  return order;
}

async function getProductAvailability(product: Product): Promise<Availability> {
  if (product.status !== "active") {
    return { available: false, reason: "商品未上架" };
  }
  if (product.deliveryMode === "card") {
    return product.availableStock && product.availableStock > 0
      ? { available: true, reason: null }
      : { available: false, reason: "卡密库存不足" };
  }
  if (product.deliveryMode === "manual") {
    return { available: true, reason: null };
  }
  return checkUpstreamAvailability(product);
}

async function checkUpstreamAvailability(product: Product): Promise<Availability> {
  const config = product.upstreamConfig;
  if (!config) {
    return { available: false, reason: "未配置上游" };
  }
  const vars = productTemplateVars(product);
  const precheck = config.precheck;
  if (precheck?.enabled) {
    if (!precheck.url) {
      return { available: false, reason: "预检测请求未配置" };
    }
    try {
      const result = await runRequest(precheck, vars);
      if (!result.ok || !checkExpectation(precheck.expect, result.data)) {
        return { available: false, reason: "预检测不通过" };
      }
    } catch {
      return { available: false, reason: "上游预检测不可用" };
    }
  }

  const stock = config.stock;
  if (stock?.enabled) {
    if (!stock.url) {
      return { available: false, reason: "库存请求未配置" };
    }
    try {
      const result = await runRequest(stock, vars);
      if (!result.ok || !checkStock(stock, result.data)) {
        return { available: false, reason: "上游无库存" };
      }
    } catch {
      return { available: false, reason: "上游库存查询不可用" };
    }
  }
  return { available: true, reason: null };
}

async function runRequest(config: UpstreamHttpRequest, vars: Record<string, string>): Promise<RequestResult> {
  if (!config.url) {
    throw new Error("请求 URL 未配置");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, config.timeoutMs ?? 5000));
  const method = config.method ?? (config.body === undefined ? "GET" : "POST");
  const headers = renderTemplateObject(config.headers ?? {}, vars) as Record<string, string>;
  const bodyValue = config.body === undefined ? undefined : renderTemplateObject(config.body, vars);
  const init: RequestInit = { method, headers, signal: controller.signal };
  if (bodyValue !== undefined && method !== "GET") {
    if (typeof bodyValue === "string") {
      init.body = bodyValue;
    } else {
      init.body = JSON.stringify(bodyValue);
      init.headers = { "content-type": "application/json", ...headers };
    }
  }

  try {
    const response = await fetch(renderTemplate(config.url, vars), init);
    const text = await response.text();
    const data = parseMaybeJson(text);
    return { ok: response.ok, status: response.status, data, text };
  } finally {
    clearTimeout(timeout);
  }
}

function checkExpectation(expectation: UpstreamHttpRequest["expect"], data: unknown) {
  if (!expectation) {
    return true;
  }
  const value = expectation.path ? getPath(data, expectation.path) : data;
  if ("equals" in expectation) {
    return sameJsonValue(value, expectation.equals);
  }
  if (expectation.exists === false) {
    return value === undefined || value === null;
  }
  return value !== undefined && value !== null && value !== false;
}

function checkStock(config: UpstreamStockRequest, data: unknown) {
  if (!checkExpectation(config.expect, data)) {
    return false;
  }
  if (config.availablePath) {
    const value = getPath(data, config.availablePath);
    return sameJsonValue(value, config.availableEquals ?? true);
  }
  if (config.stockPath) {
    const value = Number(getPath(data, config.stockPath));
    return Number.isFinite(value) && value >= (config.minStock ?? 1);
  }
  return true;
}

function checkOrderSuccess(config: UpstreamOrderRequest, data: unknown) {
  if (!config.successPath) {
    return checkExpectation(config.expect, data);
  }
  const value = getPath(data, config.successPath);
  if ("successEquals" in config) {
    return sameJsonValue(value, config.successEquals);
  }
  return Boolean(value);
}

async function notifyFeishu(ctx: AppContext, title: string, text: string) {
  const webhook = getStoreSettings(ctx).feishuWebhookUrl;
  if (!webhook) {
    return;
  }
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text: `${title}\n${text}` }
      })
    });
    writeLog(ctx, response.ok ? "info" : "warn", "feishu.notify", response.ok ? "飞书通知已发送" : "飞书通知响应异常", {
      status: response.status,
      title
    });
  } catch (error) {
    writeLog(ctx, "error", "feishu.notify", "飞书通知发送失败", { title, error: error instanceof Error ? error.message : String(error) });
  }
}

function productFromRow(ctx: AppContext, row: ProductRow): Product {
  const deliveryMode = row.delivery_mode;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    price: formatMoney(row.price_cents),
    priceCents: row.price_cents,
    status: row.status,
    coverUrl: row.cover_url,
    sortOrder: row.sort_order,
    deliveryMode,
    pickupUrl: row.pickup_url,
    pickupOpenMode: row.pickup_open_mode,
    lookupMethods: parseJson<ContactType[]>(row.lookup_methods, DEFAULT_LOOKUP_METHODS),
    upstreamConfig: parseJson<UpstreamConfig | null>(row.upstream_config, null),
    availableStock: deliveryMode === "card" ? countCards(ctx, row.id) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function orderFromRow(row: OrderRow): Order {
  return {
    id: row.id,
    productId: row.product_id,
    productSlug: row.product_slug,
    productTitle: row.product_title,
    amount: formatMoney(row.amount_cents),
    amountCents: row.amount_cents,
    contactType: row.contact_type,
    contactValue: row.contact_value,
    remark: row.remark,
    status: row.status,
    peerpayOrderId: row.peerpay_order_id,
    peerpayPayUrl: row.peerpay_pay_url,
    peerpayActualAmount: row.peerpay_actual_amount_cents === null ? null : formatMoney(row.peerpay_actual_amount_cents),
    peerpayActualAmountCents: row.peerpay_actual_amount_cents,
    peerpayPaymentChannel: row.peerpay_payment_channel,
    deliveryMode: row.delivery_mode,
    deliveryPayload: row.delivery_payload,
    pickupUrl: row.pickup_url,
    pickupOpenMode: row.pickup_open_mode,
    upstreamOrderId: row.upstream_order_id,
    upstreamResponse: parseJson<unknown>(row.upstream_response, null),
    manualReason: row.manual_reason,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    deliveredAt: row.delivered_at,
    updatedAt: row.updated_at
  };
}

function logFromRow(row: SystemLogRow): SystemLog {
  return {
    id: row.id,
    level: row.level,
    action: row.action,
    message: row.message,
    context: parseJson<unknown>(row.context, null),
    createdAt: row.created_at
  };
}

function normalizeProductInput(input: CreateProductInput | (Product & UpdateProductInput)) {
  const title = input.title?.trim();
  if (!title) {
    throw apiError(400, "商品名称不能为空");
  }
  const priceCents = parseMoney(input.price);
  if (priceCents <= 0) {
    throw apiError(400, "商品价格必须大于 0");
  }
  const status = input.status ?? "draft";
  const deliveryMode = input.deliveryMode ?? "card";
  const pickupOpenMode = input.pickupOpenMode ?? (input.pickupUrl ? "iframe" : "none");
  const lookupMethods = normalizeLookupMethods(input.lookupMethods ?? DEFAULT_LOOKUP_METHODS);
  return {
    slug: normalizeSlug(input.slug || title),
    title,
    description: input.description?.trim() ?? "",
    priceCents,
    status,
    coverUrl: blankToNull(input.coverUrl),
    sortOrder: Number(input.sortOrder ?? 100),
    deliveryMode,
    pickupUrl: blankToNull(input.pickupUrl),
    pickupOpenMode,
    lookupMethods,
    upstreamConfig: input.upstreamConfig ?? null
  };
}

function getOrderProduct(ctx: AppContext, input: CreateOrderInput) {
  if (input.productId) {
    return getProductById(ctx, Number(input.productId));
  }
  if (input.slug) {
    const row = ctx.db.query("SELECT * FROM products WHERE slug = ?").get(input.slug) as ProductRow | null;
    return row ? productFromRow(ctx, row) : null;
  }
  throw apiError(400, "请选择商品");
}

function countCards(ctx: AppContext, productId: number) {
  const row = ctx.db.query("SELECT COUNT(*) AS count FROM product_cards WHERE product_id = ? AND status = 'available'").get(productId) as { count: number };
  return row.count;
}

function parseMoney(value: string | number) {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw apiError(400, "金额格式不正确");
  }
  const [yuan, cents = ""] = text.split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
}

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function normalizeContact(value: string) {
  const text = value.trim();
  if (!text) {
    throw apiError(400, "联系方式不能为空");
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return text.toLowerCase();
  }
  if (/^\+?\d[\d -]{6,18}\d$/.test(text)) {
    return text.replace(/[ -]/g, "");
  }
  return text;
}

function normalizeOrderPaymentChannel(value: unknown): PaymentChannel {
  if (value === "alipay" || value === "wechat") {
    return value;
  }
  throw apiError(400, "请选择支付方式");
}

function normalizeOrderRemark(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > 500) {
    throw apiError(400, "备注不能超过 500 字");
  }
  return text || null;
}

function detectContactType(value: string): ContactType {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "email";
  }
  if (/^\+?\d{7,20}$/.test(value) && (value.startsWith("+") || /^1\d{10}$/.test(value))) {
    return "phone";
  }
  if (/^\d{5,12}$/.test(value)) {
    return "qq";
  }
  return "contact";
}

function normalizeLookupMethods(value: ContactType[]) {
  const allowed = new Set<ContactType>(["contact", "phone", "qq", "email"]);
  const result = value.filter((item): item is ContactType => allowed.has(item));
  return result.length ? Array.from(new Set(result)) : DEFAULT_LOOKUP_METHODS;
}

function normalizeStoreAds(value: StoreAd[]) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => ({
      title: item.title?.trim() ?? "",
      body: item.body?.trim() || undefined,
      gradientColor: normalizeHexColor(item.gradientColor),
      imageUrl: blankToNull(item.imageUrl),
      linkUrl: blankToNull(item.linkUrl),
      linkText: item.linkText?.trim() || undefined
    }))
    .filter((item) => item.title)
    .slice(0, 12);
}

function normalizeCards(value: string[] | string) {
  const items = Array.isArray(value) ? value : value.split(/\r?\n/);
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function normalizeSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `product-${Date.now().toString(36)}`;
}

function blankToNull(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

function normalizeHexColor(value: string | null | undefined) {
  const text = value?.trim();
  return text && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text) ? text : null;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) {
    return fallback;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function parseMaybeJson(text: string) {
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getPath(data: unknown, path: string) {
  if (!path) {
    return data;
  }
  return path
    .replace(/\[(\d+)]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((value, key) => {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (Array.isArray(value)) {
        return value[Number(key)];
      }
      if (typeof value === "object") {
        return (value as Record<string, unknown>)[key];
      }
      return undefined;
    }, data);
}

function renderTemplateObject(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") {
    return renderTemplate(value, vars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplateObject(item, vars));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplateObject(item, vars)]));
  }
  return value;
}

function renderTemplate(value: string, vars: Record<string, string>) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, key: string) => vars[key] ?? "");
}

function productTemplateVars(product: Product) {
  return {
    productId: String(product.id),
    productSlug: product.slug,
    productTitle: product.title,
    sku: product.upstreamConfig?.sku ?? product.slug,
    token: product.upstreamConfig?.token ?? "",
    price: product.price
  };
}

function orderTemplateVars(product: Product, order: Order) {
  return {
    ...productTemplateVars(product),
    orderId: order.id,
    contactType: order.contactType,
    contact: order.contactValue,
    paymentChannel: order.peerpayPaymentChannel ?? "",
    remark: order.remark ?? "",
    amount: order.amount
  };
}

function sameJsonValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function createOrderId() {
  return `ord_${randomBytes(8).toString("hex")}`;
}

function maskSecret(secret: string) {
  if (secret.length <= 8) {
    return "*".repeat(secret.length);
  }
  return `${secret.slice(0, 4)}${"*".repeat(Math.min(12, secret.length - 8))}${secret.slice(-4)}`;
}

function formatOrderNotice(order: Order) {
  return [
    `订单号：${order.id}`,
    `商品：${order.productTitle}`,
    `金额：${order.amount}`,
    `联系方式：${order.contactValue}`,
    order.peerpayPaymentChannel ? `支付方式：${PAYMENT_CHANNEL_LABELS[order.peerpayPaymentChannel]}` : null,
    order.remark ? `备注：${order.remark}` : null,
    `状态：${order.status}`,
    order.peerpayOrderId ? `PeerPay 订单：${order.peerpayOrderId}` : null,
    order.manualReason ? `原因：${order.manualReason}` : null
  ].filter(Boolean).join("\n");
}

function getOrderCallbackSecret(ctx: AppContext, orderId: string) {
  const row = ctx.db.query("SELECT peerpay_callback_secret FROM orders WHERE id = ?").get(orderId) as { peerpay_callback_secret: string | null } | null;
  return row?.peerpay_callback_secret ?? null;
}

function signPeerPayPayload(payload: PeerPayCallbackPayload, secret: string) {
  const canonical = Object.keys(payload)
    .filter((key) => key !== "sign")
    .sort()
    .map((key) => `${key}=${(payload as Record<string, unknown>)[key] ?? ""}`)
    .join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function verifyPeerPayCallback(payload: PeerPayCallbackPayload, headerSign: string, secret: string) {
  const expected = signPeerPayPayload(payload, secret);
  return safeEqualHex(payload.sign ?? "", expected) && safeEqualHex(headerSign, expected);
}

function safeEqualHex(value: string, expected: string) {
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function normalizePaymentChannel(value: unknown): PaymentChannel {
  return value === "wechat" ? "wechat" : "alipay";
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}
