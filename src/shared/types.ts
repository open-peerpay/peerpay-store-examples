export type ProductStatus = "draft" | "active" | "archived";
export type DeliveryMode = "card" | "upstream" | "manual";
export type PickupOpenMode = "none" | "iframe" | "new_tab";
export type ContactType = "contact" | "phone" | "qq" | "email";
export type PaymentChannel = "alipay" | "wechat";
export type OrderStatus = "pending_payment" | "paid" | "delivered" | "needs_manual" | "failed" | "cancelled";
export type LogLevel = "info" | "warn" | "error";
export type HttpBodyType = "json" | "form" | "raw";

export interface HttpExpectation {
  path?: string;
  equals?: unknown;
  exists?: boolean;
}

export interface UpstreamHttpRequest {
  enabled?: boolean;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
  bodyType?: HttpBodyType;
  timeoutMs?: number;
  expect?: HttpExpectation;
}

export interface UpstreamStockRequest extends UpstreamHttpRequest {
  stockPath?: string;
  minStock?: number;
  availablePath?: string;
  availableEquals?: unknown;
}

export interface UpstreamOrderRequest extends UpstreamHttpRequest {
  successPath?: string;
  successEquals?: unknown;
  deliveryPath?: string;
  remoteOrderIdPath?: string;
}

export interface UpstreamConfig {
  sku?: string;
  token?: string;
  precheck?: UpstreamHttpRequest;
  stock?: UpstreamStockRequest;
  order?: UpstreamOrderRequest;
}

export interface Product {
  id: number;
  slug: string;
  title: string;
  description: string;
  price: string;
  priceCents: number;
  status: ProductStatus;
  coverUrl: string | null;
  sortOrder: number;
  deliveryMode: DeliveryMode;
  pickupUrl: string | null;
  pickupOpenMode: PickupOpenMode;
  lookupMethods: ContactType[];
  upstreamConfig: UpstreamConfig | null;
  availableStock: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProduct extends Product {
  available: boolean;
  availabilityReason: string | null;
}

export interface ProductCard {
  id: number;
  productId: number;
  status: "available" | "delivered";
  secretPreview: string;
  orderId: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface Order {
  id: string;
  productId: number;
  productSlug: string;
  productTitle: string;
  amount: string;
  amountCents: number;
  contactType: ContactType;
  contactValue: string;
  remark: string | null;
  status: OrderStatus;
  peerpayOrderId: string | null;
  peerpayPayUrl: string | null;
  peerpayActualAmount: string | null;
  peerpayActualAmountCents: number | null;
  peerpayPaymentChannel: PaymentChannel | null;
  deliveryMode: DeliveryMode;
  deliveryPayload: string | null;
  pickupUrl: string | null;
  pickupOpenMode: PickupOpenMode;
  upstreamOrderId: string | null;
  upstreamResponse: unknown;
  manualReason: string | null;
  createdAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface SystemLog {
  id: number;
  level: LogLevel;
  action: string;
  message: string;
  context: unknown;
  createdAt: string;
}

export interface StoreAd {
  title: string;
  body?: string;
  gradientColor?: string | null;
  imageUrl?: string | null;
  linkUrl?: string | null;
  linkText?: string;
}

export interface StoreSettings {
  feishuWebhookUrl: string | null;
  storeName: string;
  storeNotice: string;
  ads: StoreAd[];
  peerpayBaseUrl: string | null;
  storeBaseUrl: string | null;
  peerpayPaymentChannel: PaymentChannel;
  peerpayTtlMinutes: number;
}

export interface DashboardStats {
  products: {
    total: number;
    active: number;
    cardStock: number;
  };
  orders: {
    total: number;
    delivered: number;
    needsManual: number;
    today: number;
  };
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSessionState {
  setupRequired: boolean;
  authenticated: boolean;
}

export interface CreateProductInput {
  slug?: string;
  title: string;
  description?: string;
  price: string | number;
  status?: ProductStatus;
  coverUrl?: string | null;
  sortOrder?: number;
  deliveryMode?: DeliveryMode;
  pickupUrl?: string | null;
  pickupOpenMode?: PickupOpenMode;
  lookupMethods?: ContactType[];
  upstreamConfig?: UpstreamConfig | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export interface CreateOrderInput {
  productId?: number;
  slug?: string;
  contactType?: ContactType;
  contactValue: string;
  paymentChannel: PaymentChannel;
  remark?: string;
}

export interface CreateOrderResult {
  order: Order;
  paymentUrl: string | null;
  rememberedAt: string;
}

export interface AddCardsInput {
  cards: string[] | string;
}
