import { describe, expect, test } from "bun:test";
import { createDatabase } from "../server/db";
import {
  addCards,
  createOrder,
  createProduct,
  findOrdersByContact,
  getPublicProduct,
  getStoreSettings,
  handlePeerPayCallback,
  listPublicProducts,
  updateOrderStatus,
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

  test("applies upstream precheck expect before creating a payment", async () => {
    const ctx = createTestContext();
    const restoreFetch = mockFetch(async (url) => {
      if (url.origin === "https://upstream.test" && url.pathname === "/precheck") {
        return Response.json({ ok: false });
      }
      return undefined;
    });
    createProduct(ctx, {
      title: "预检商品",
      slug: "precheck-expect",
      price: "19.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        sku: "precheck-expect",
        precheck: {
          enabled: true,
          method: "GET",
          url: "https://upstream.test/precheck?sku={{sku}}",
          expect: { path: "ok", equals: true }
        },
        order: { enabled: true, url: "https://upstream.test/order" }
      }
    });

    try {
      await expect(createOrder(ctx, {
        slug: "precheck-expect",
        contactValue: "buyer",
        paymentChannel: "alipay"
      })).rejects.toThrow("预检测不通过");
    } finally {
      restoreFetch();
    }
  });

  test("runs upstream precheck on product detail instead of public list", async () => {
    const ctx = createTestContext();
    let precheckCalls = 0;
    let precheckBody = "";
    const restoreFetch = mockFetch(async (url, init) => {
      if (url.origin === "https://upstream.test" && url.pathname === "/precheck") {
        precheckCalls += 1;
        precheckBody = String(init?.body ?? "");
        return Response.json({ ok: false });
      }
      return undefined;
    });
    createProduct(ctx, {
      title: "详情预检商品",
      slug: "detail-precheck",
      price: "19.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        sku: "detail-precheck",
        precheck: {
          enabled: true,
          method: "POST",
          url: "https://upstream.test/precheck?sku={{sku}}",
          bodyType: "form",
          body: { password: "&num=1&captcha=&item_id=7" },
          expect: { path: "ok", equals: true }
        },
        order: { enabled: true, url: "https://upstream.test/order" }
      }
    });

    try {
      const list = await listPublicProducts(ctx);
      expect(precheckCalls).toBe(0);
      expect(list[0]?.available).toBe(true);
      expect(list[0]?.availabilityReason).toBeNull();
      expect(list[0]?.deliveryMode).toBe("manual");
      expect(list[0]?.upstreamConfig).toBeNull();

      const detail = await getPublicProduct(ctx, "detail-precheck");
      expect(precheckCalls).toBe(1);
      expect(precheckBody).toBe("password=&num=1&captcha=&item_id=7");
      expect(detail?.available).toBe(false);
      expect(detail?.availabilityReason).toBe("无库存");
      expect(detail?.deliveryMode).toBe("manual");
      expect(detail?.upstreamConfig).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("sends upstream POST body as x-www-form-urlencoded", async () => {
    const ctx = createTestContext();
    let upstreamBody = "";
    let upstreamContentType = "";
    const restoreFetch = mockFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.origin === "http://peerpay.test" && url.pathname === "/api/orders") {
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
      if (method === "POST" && url.origin === "https://upstream.test" && url.pathname === "/order") {
        upstreamBody = String(init?.body ?? "");
        upstreamContentType = headerValue(init?.headers, "content-type");
        return Response.json({ ok: true, data: { secret: "DYNAMIC-CARD-001", orderId: "remote-001" } });
      }
      return undefined;
    });

    createProduct(ctx, {
      title: "表单上游",
      slug: "form-upstream",
      price: "21.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        sku: "form-sku",
        token: "form-token",
        order: {
          enabled: true,
          method: "POST",
          url: "https://upstream.test/order",
          bodyType: "form",
          body: {
            sku: "{{sku}}",
            orderId: "{{orderId}}",
            contact: "{{contact}}"
          },
          expect: { path: "ok", equals: true },
          deliveryPath: "data.secret",
          remoteOrderIdPath: "data.orderId"
        }
      }
    });

    try {
      ctx.db.query("INSERT INTO app_settings(key, value, updated_at) VALUES ('peerpay_base_url', ?, ?)").run("http://peerpay.test", new Date().toISOString());
      const result = await createOrder(ctx, {
        slug: "form-upstream",
        contactValue: "buyer@example.com",
        paymentChannel: "wechat"
      }, "http://store.test/api/public/orders");
      const secret = ctx.db.query("SELECT peerpay_callback_secret AS secret FROM orders WHERE id = ?").get(result.order.id) as { secret: string };
      const payload = {
        orderId: result.order.peerpayOrderId!,
        merchantOrderId: result.order.id,
        paymentAccountCode: "wechat-a",
        paymentChannel: "wechat" as const,
        status: "paid",
        requestedAmount: "21.00",
        actualAmount: "21.00",
        paidAt: "2026-05-04T00:00:00.000Z"
      };
      const sign = signPeerPayPayload(payload, secret.secret);
      const callback = await handlePeerPayCallback(ctx, { ...payload, sign }, sign);

      expect(callback.order.status).toBe("delivered");
      expect(callback.order.deliveryPayload).toBe("DYNAMIC-CARD-001");
      expect(callback.order.upstreamOrderId).toBe("remote-001");
      expect(upstreamContentType).toContain("application/x-www-form-urlencoded");
      expect(upstreamBody).toContain("sku=form-sku");
      expect(upstreamBody).toContain(`orderId=${encodeURIComponent(result.order.id)}`);
      expect(upstreamBody).toContain("contact=buyer%40example.com");
    } finally {
      restoreFetch();
    }
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

  test("requires and stores delivery payload when admin fulfills manual orders", async () => {
    const ctx = createTestContext();
    const restorePeerPay = mockPeerPayFetch();
    createProduct(ctx, {
      title: "人工卡密",
      slug: "manual-card",
      price: "12.00",
      status: "active",
      deliveryMode: "manual"
    });

    try {
      ctx.db.query("INSERT INTO app_settings(key, value, updated_at) VALUES ('peerpay_base_url', ?, ?)").run("http://peerpay.test", new Date().toISOString());
      const result = await createOrder(ctx, {
        slug: "manual-card",
        contactValue: "buyer",
        paymentChannel: "alipay"
      }, "http://store.test/api/public/orders");

      expect(() => updateOrderStatus(ctx, result.order.id, "delivered", "后台标记已处理")).toThrow("请填写卡密或发货内容");

      const delivered = updateOrderStatus(ctx, result.order.id, "delivered", "后台填写发货内容", "MANUAL-CARD-001");
      expect(delivered?.status).toBe("delivered");
      expect(delivered?.deliveryPayload).toBe("MANUAL-CARD-001");
      expect(delivered?.manualReason).toBeNull();
      expect(delivered?.deliveredAt).toBeTruthy();
    } finally {
      restorePeerPay();
    }
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

function mockFetch(handler: (url: URL, init?: Parameters<typeof fetch>[1]) => Response | undefined | Promise<Response | undefined>) {
  const originalFetch = globalThis.fetch;
  const mocked = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const response = await handler(url, init);
    return response ?? originalFetch(input, init);
  };
  globalThis.fetch = Object.assign(mocked, { preconnect: originalFetch.preconnect }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function headerValue(headers: HeadersInit | undefined, name: string) {
  if (!headers) {
    return "";
  }
  const target = name.toLowerCase();
  if (headers instanceof Headers) {
    return headers.get(name) ?? "";
  }
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === target)?.[1] ?? "";
  }
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1] ?? "";
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
