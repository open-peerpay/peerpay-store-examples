import type {
  AddCardsInput,
  AdminSessionState,
  CreateOrderInput,
  CreateOrderResult,
  CreateProductInput,
  DashboardStats,
  Order,
  OrderStatus,
  Page,
  Product,
  ProductCard,
  ProductStatus,
  PublicProduct,
  StoreSettings,
  SystemLog,
  UpdateProductInput
} from "../shared/types";

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorEnvelope {
  data?: {
    error?: string;
  };
  error?: string;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T> & ApiErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.data?.error ?? payload.error ?? `请求失败 (${response.status})`);
  }
  return payload.data;
}

export function getAdminSession() {
  return request<AdminSessionState>("/api/admin/session");
}

export function setupAdmin(password: string) {
  return request<AdminSessionState>("/api/admin/setup", { method: "POST", body: JSON.stringify({ password }) });
}

export function loginAdmin(password: string) {
  return request<AdminSessionState>("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
}

export function logoutAdmin() {
  return request<{ ok: boolean }>("/api/admin/logout", { method: "POST" });
}

export function loadAdminSnapshot() {
  return Promise.all([
    request<DashboardStats>("/api/admin/dashboard"),
    request<StoreSettings>("/api/admin/settings"),
    request<Product[]>("/api/admin/products"),
    request<Page<Order>>("/api/admin/orders?limit=100"),
    request<Page<SystemLog>>("/api/admin/logs?limit=80")
  ]).then(([dashboard, settings, products, orders, logs]) => ({
    dashboard,
    settings,
    products,
    orders,
    logs
  }));
}

export type AdminSnapshot = Awaited<ReturnType<typeof loadAdminSnapshot>>;

export function saveSettings(input: Partial<StoreSettings>) {
  return request<StoreSettings>("/api/admin/settings", { method: "POST", body: JSON.stringify(input) });
}

export async function uploadImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/admin/uploads", { method: "POST", body: form });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<{ url: string; fileName: string }> & ApiErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.data?.error ?? payload.error ?? `上传失败 (${response.status})`);
  }
  return payload.data;
}

export function createProduct(input: CreateProductInput) {
  return request<Product>("/api/admin/products", { method: "POST", body: JSON.stringify(input) });
}

export function updateProduct(id: number, input: UpdateProductInput) {
  return request<Product>(`/api/admin/products/${id}`, { method: "POST", body: JSON.stringify(input) });
}

export function setProductStatus(id: number, status: ProductStatus) {
  return request<Product>(`/api/admin/products/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
}

export function addProductCards(id: number, input: AddCardsInput) {
  return request<{ saved: number; availableStock: number }>(`/api/admin/products/${id}/cards`, { method: "POST", body: JSON.stringify(input) });
}

export function listProductCards(id: number) {
  return request<ProductCard[]>(`/api/admin/products/${id}/cards`);
}

export function updateOrderStatus(id: string, status: OrderStatus, manualReason?: string) {
  return request<Order>(`/api/admin/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status, manualReason }) });
}

export function loadPublicStore() {
  return request<{ settings: StoreSettings; products: PublicProduct[] }>("/api/public/store");
}

export function loadPublicProduct(slug: string) {
  return request<PublicProduct | null>(`/api/public/products/${encodeURIComponent(slug)}`);
}

export function createPublicOrder(input: CreateOrderInput) {
  return request<CreateOrderResult>("/api/public/orders", { method: "POST", body: JSON.stringify(input) });
}

export function loadPublicOrder(id: string) {
  return request<Order | null>(`/api/public/orders/${encodeURIComponent(id)}`);
}

export function searchOrders(contact: string) {
  const params = new URLSearchParams({ contact });
  return request<Order[]>(`/api/public/orders?${params.toString()}`);
}
