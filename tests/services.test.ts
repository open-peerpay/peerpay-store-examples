import { describe, expect, test } from "bun:test";
import { createDatabase } from "../server/db";
import {
  addCards,
  createOrder,
  createProduct,
  findOrdersByContact,
  getStoreSettings,
  handlePeerPayCallback,
  updateStoreSettings,
  type AppContext
} from "../server/services";
import { createHmac } from "node:crypto";

function createTestContext(): AppContext {
  return { db: createDatabase(":memory:") };
}

describe("store services", () => {
  test("creates PeerPay payment and delivers card inventory after callback", async () => {
    const ctx = createTestContext();
    const restorePeerPay = mockPeerPayFetch();
    const product = createProduct(ctx, {
      title: "测试卡密",
      slug: "test-card",
      price: "9.90",
      status: "active",
      deliveryMode: "card"
    });
    addCards(ctx, product!.id, { cards: ["CARD-001"] });

    try {
      ctx.db.query("INSERT INTO app_settings(key, value, updated_at) VALUES ('peerpay_base_url', ?, ?)").run("http://peerpay.test", new Date().toISOString());
      const result = await createOrder(ctx, {
        slug: "test-card",
        contactValue: "13800138000",
        paymentChannel: "wechat",
        remark: "请优先自动发货，异常时联系我"
      }, "http://store.test/api/public/orders");

      expect(result.order.status).toBe("pending_payment");
      expect(result.paymentUrl).toContain("/pay/");
      expect(result.order.peerpayPaymentChannel).toBe("wechat");
      expect(result.order.remark).toBe("请优先自动发货，异常时联系我");

      const secret = ctx.db.query("SELECT peerpay_callback_secret AS secret FROM orders WHERE id = ?").get(result.order.id) as { secret: string };
      const payload = {
        orderId: result.order.peerpayOrderId!,
        merchantOrderId: result.order.id,
        paymentAccountCode: "wechat-a",
        paymentChannel: "wechat" as const,
        status: "paid",
        requestedAmount: "9.90",
        actualAmount: "9.90",
        paidAt: "2026-05-04T00:00:00.000Z"
      };
      const sign = signPeerPayPayload(payload, secret.secret);
      const callback = await handlePeerPayCallback(ctx, { ...payload, sign }, sign);

      expect(callback.order.status).toBe("delivered");
      expect(callback.order.deliveryPayload).toBe("CARD-001");
      expect(findOrdersByContact(ctx, "13800138000")).toHaveLength(1);
    } finally {
      restorePeerPay();
    }
  });

  test("treats failed upstream precheck as out of stock", async () => {
    const ctx = createTestContext();
    createProduct(ctx, {
      title: "动态商品",
      slug: "dynamic",
      price: "19.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        sku: "dynamic",
        precheck: { enabled: true },
        order: { enabled: true, url: "https://upstream.invalid/order" }
      }
    });

    await expect(createOrder(ctx, {
      slug: "dynamic",
      contactValue: "123456",
      paymentChannel: "alipay"
    })).rejects.toThrow("预检测请求未配置");
  });

  test("requires a payment channel when creating an order", async () => {
    const ctx = createTestContext();
    createProduct(ctx, {
      title: "必选支付方式商品",
      slug: "payment-required",
      price: "6.00",
      status: "active",
      deliveryMode: "manual"
    });

    await expect(createOrder(ctx, {
      slug: "payment-required",
      contactValue: "buyer"
    } as Parameters<typeof createOrder>[1])).rejects.toThrow("请选择支付方式");
  });

  test("reads PeerPay integration settings from SQLite instead of environment variables", () => {
    const ctx = createTestContext();
    const previousBaseUrl = Bun.env.PEERPAY_BASE_URL;
    const previousStoreBaseUrl = Bun.env.STORE_BASE_URL;
    const previousChannel = Bun.env.PEERPAY_PAYMENT_CHANNEL;
    const previousTtl = Bun.env.PEERPAY_TTL_MINUTES;

    Bun.env.PEERPAY_BASE_URL = "https://env-peerpay.invalid";
    Bun.env.STORE_BASE_URL = "https://env-store.invalid";
    Bun.env.PEERPAY_PAYMENT_CHANNEL = "wechat";
    Bun.env.PEERPAY_TTL_MINUTES = "90";

    try {
      expect(getStoreSettings(ctx).peerpayBaseUrl).toBeNull();
      expect(getStoreSettings(ctx).storeBaseUrl).toBeNull();
      expect(getStoreSettings(ctx).peerpayPaymentChannel).toBe("alipay");
      expect(getStoreSettings(ctx).peerpayTtlMinutes).toBe(15);

      const saved = updateStoreSettings(ctx, {
        peerpayBaseUrl: "https://sqlite-peerpay.test",
        storeBaseUrl: "https://sqlite-store.test",
        peerpayPaymentChannel: "wechat",
        peerpayTtlMinutes: 30
      });

      expect(saved.peerpayBaseUrl).toBe("https://sqlite-peerpay.test");
      expect(saved.storeBaseUrl).toBe("https://sqlite-store.test");
      expect(saved.peerpayPaymentChannel).toBe("wechat");
      expect(saved.peerpayTtlMinutes).toBe(30);
    } finally {
      restoreEnv("PEERPAY_BASE_URL", previousBaseUrl);
      restoreEnv("STORE_BASE_URL", previousStoreBaseUrl);
      restoreEnv("PEERPAY_PAYMENT_CHANNEL", previousChannel);
      restoreEnv("PEERPAY_TTL_MINUTES", previousTtl);
    }
  });
});

function mockPeerPayFetch() {
  const originalFetch = globalThis.fetch;
  const mockFetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    if (method === "POST" && url.pathname === "/api/orders") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { merchantOrderId: string; amount: string; paymentChannel: string };
      return Response.json({
        data: {
          id: `pay_${body.merchantOrderId}`,
          merchantOrderId: body.merchantOrderId,
          payUrl: `${url.origin}/pay/pay_${body.merchantOrderId}`,
          actualAmount: body.amount,
          actualAmountCents: Math.round(Number(body.amount) * 100),
          paymentChannel: body.paymentChannel
        }
      }, { status: 201 });
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = Object.assign(mockFetch, { preconnect: originalFetch.preconnect }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function signPeerPayPayload(payload: Record<string, unknown>, secret: string) {
  const canonical = Object.keys(payload)
    .filter((key) => key !== "sign")
    .sort()
    .map((key) => `${key}=${payload[key] ?? ""}`)
    .join("&");
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete Bun.env[key];
    return;
  }
  Bun.env[key] = value;
}
