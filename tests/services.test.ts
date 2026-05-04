import { describe, expect, test } from "bun:test";
import { createDatabase } from "../server/db";
import {
  addCards,
  createOrder,
  createProduct,
  findOrdersByContact,
  handlePeerPayCallback,
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
        contactValue: "13800138000"
      }, "http://store.test/api/public/orders");

      expect(result.order.status).toBe("pending_payment");
      expect(result.paymentUrl).toContain("/pay/");

      const secret = ctx.db.query("SELECT peerpay_callback_secret AS secret FROM orders WHERE id = ?").get(result.order.id) as { secret: string };
      const payload = {
        orderId: result.order.peerpayOrderId!,
        merchantOrderId: result.order.id,
        paymentAccountCode: "alipay-a",
        paymentChannel: "alipay" as const,
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
      contactValue: "123456"
    })).rejects.toThrow("预检测请求未配置");
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
