import type { ContactType, DeliveryMode, OrderStatus, PaymentChannel, PickupOpenMode, ProductStatus, UpstreamConfig } from "./types";

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  contact: "联系方式",
  phone: "手机号",
  qq: "QQ",
  email: "邮箱"
};

export const CONTACT_TYPE_OPTIONS = Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => ({
  value: value as ContactType,
  label
}));

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  alipay: "支付宝",
  wechat: "微信"
};

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  card: "卡密自动发货",
  upstream: "动态上游取货",
  manual: "人工处理"
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "草稿",
  active: "上架",
  archived: "下架"
};

export const PICKUP_OPEN_MODE_LABELS: Record<PickupOpenMode, string> = {
  none: "不展示",
  iframe: "内嵌提货",
  new_tab: "新标签打开"
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "待支付",
  paid: "已支付",
  delivered: "已发货",
  needs_manual: "人工介入",
  failed: "失败",
  cancelled: "已取消"
};

export const DEFAULT_LOOKUP_METHODS: ContactType[] = ["contact", "phone", "qq", "email"];

export const DEFAULT_UPSTREAM_CONFIG_EXAMPLE = {
  sku: "demo-sku",
  precheck: {
    enabled: false,
    method: "GET",
    url: "https://upstream.example/api/precheck?sku={{sku}}",
    expect: { path: "ok", equals: true }
  },
  stock: {
    enabled: false,
    method: "GET",
    url: "https://upstream.example/api/stock?sku={{sku}}",
    stockPath: "data.stock",
    minStock: 1
  },
  order: {
    enabled: false,
    method: "POST",
    url: "https://upstream.example/api/orders",
    bodyType: "json",
    headers: { authorization: "Bearer {{token}}" },
    body: {
      sku: "{{sku}}",
      orderId: "{{orderId}}",
      contact: "{{contact}}"
    },
    successPath: "code",
    successEquals: 0,
    deliveryPath: "data.secret",
    remoteOrderIdPath: "data.orderId"
  }
} satisfies UpstreamConfig;
