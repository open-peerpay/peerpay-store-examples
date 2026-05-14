import { describe, expect, test } from "bun:test";
import { createDatabase } from "../server/db";
import {
  addCards,
  createUpstreamChannel,
  createOrder,
  createProduct,
  deleteUpstreamChannel,
  dashboardStats,
  findOrdersByContact,
  getPublicProduct,
  getPublicProductAvailability,
  getPublicProductCaptcha,
  getPublicOrder,
  getStoreSettings,
  handlePeerPayCallback,
  listUpstreamChannels,
  listPublicProducts,
  updateUpstreamChannel,
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

  test("marks PeerPay creation failures as failed orders instead of manual intervention", async () => {
    const ctx = createTestContext();
    const restoreFetch = mockFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.origin === "http://peerpay.test" && url.pathname === "/api/orders") {
        return Response.json({ data: { error: "PeerPay 临时不可用" } }, { status: 502 });
      }
      return undefined;
    });
    const product = createProduct(ctx, {
      title: "支付失败卡密",
      slug: "payment-failed-card",
      price: "9.90",
      status: "active",
      deliveryMode: "card"
    });
    addCards(ctx, product!.id, { cards: ["CARD-FAILED-001"] });

    try {
      ctx.db.query("INSERT INTO app_settings(key, value, updated_at) VALUES ('peerpay_base_url', ?, ?)").run("http://peerpay.test", new Date().toISOString());

      await expect(createOrder(ctx, {
        slug: "payment-failed-card",
        contactValue: "buyer@example.com",
        paymentChannel: "alipay"
      }, "http://store.test/api/public/orders")).rejects.toThrow("支付暂不可用，请稍后再试");

      const orders = findOrdersByContact(ctx, "buyer@example.com");
      expect(orders).toHaveLength(1);
      expect(orders[0]?.status).toBe("failed");
      expect(orders[0]?.manualReason).toBe("PeerPay 临时不可用");
      expect(getPublicOrder(ctx, orders[0]!.id)?.manualReason).toBeNull();
      expect(dashboardStats(ctx).orders.needsManual).toBe(0);
    } finally {
      restoreFetch();
    }
  });

  test("manages reusable upstream channels", () => {
    const ctx = createTestContext();
    const created = createUpstreamChannel(ctx, {
      name: "爱搜渠道",
      description: "验证码和估价接口",
      config: {
        captcha: { enabled: true, method: "GET", url: "https://upstream.test/captcha" },
        precheck: { enabled: true, method: "POST", url: "https://upstream.test/precheck" },
        stock: { enabled: true, method: "POST", url: "https://upstream.test/stock", stockPath: "data.stock" },
        order: { enabled: true, method: "POST", url: "https://upstream.test/order", deliveryPath: "data.secret" }
      }
    });

    expect(created?.name).toBe("爱搜渠道");
    expect(listUpstreamChannels(ctx)).toHaveLength(1);

    const updated = updateUpstreamChannel(ctx, created!.id, {
      name: "爱搜渠道 2",
      config: {
        precheck: { enabled: true, method: "POST", url: "https://upstream.test/precheck" },
        order: { enabled: true, method: "POST", url: "https://upstream.test/order", deliveryPath: "data.secret" }
      }
    });

    expect(updated?.name).toBe("爱搜渠道 2");
    expect(updated?.config.stock).toBeUndefined();
    expect(deleteUpstreamChannel(ctx, created!.id).ok).toBe(true);
    expect(listUpstreamChannels(ctx)).toHaveLength(0);
  });

  test("persists selected upstream channel on products", async () => {
    const ctx = createTestContext();
    const restoreFetch = mockFetch(async (url) => {
      if (url.origin === "https://upstream.test" && url.pathname === "/stock") {
        return Response.json({ data: { stock: 5 } });
      }
      return undefined;
    });
    const channel = createUpstreamChannel(ctx, {
      name: "模板渠道",
      config: {
        captcha: { enabled: true, method: "GET", url: "https://upstream.test/captcha" },
        precheck: { enabled: true, method: "POST", url: "https://upstream.test/precheck" },
        stock: { enabled: true, method: "POST", url: "https://upstream.test/stock", stockPath: "data.stock" },
        order: { enabled: true, method: "POST", url: "https://upstream.test/order", deliveryPath: "data.secret" }
      }
    });

    const product = createProduct(ctx, {
      title: "渠道商品",
      slug: "channel-product",
      price: "20.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamChannelId: channel!.id,
      upstreamConfig: {
        sku: "sku-001",
        token: "token-001"
      }
    });

    expect(product?.upstreamChannelId).toBe(channel!.id);
    expect(product?.upstreamConfig?.sku).toBe("sku-001");
    expect(product?.upstreamConfig?.captcha?.enabled).toBe(true);
    expect(product?.upstreamConfig?.precheck?.url).toBe("https://upstream.test/precheck");
    expect(product?.upstreamConfig?.stock?.stockPath).toBe("data.stock");
    expect(product?.upstreamConfig?.order?.deliveryPath).toBe("data.secret");

    const raw = ctx.db.query("SELECT upstream_config AS config FROM products WHERE id = ?").get(product!.id) as { config: string };
    expect(JSON.parse(raw.config)).toEqual({ sku: "sku-001", token: "token-001" });

    try {
      const publicProduct = await getPublicProductAvailability(ctx, "channel-product");
      expect(publicProduct?.upstreamChannelId).toBeNull();
      expect(publicProduct?.upstreamConfig).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("hides embedded pickup until the order is paid", async () => {
    const ctx = createTestContext();
    const restorePeerPay = mockPeerPayFetch();
    createProduct(ctx, {
      title: "内嵌提货商品",
      slug: "pickup-iframe",
      price: "12.00",
      status: "active",
      deliveryMode: "manual",
      pickupUrl: "https://pickup.test/self-service",
      pickupOpenMode: "iframe"
    });

    try {
      ctx.db.query("INSERT INTO app_settings(key, value, updated_at) VALUES ('peerpay_base_url', ?, ?)").run("http://peerpay.test", new Date().toISOString());
      const result = await createOrder(ctx, {
        slug: "pickup-iframe",
        contactValue: "buyer@example.com",
        paymentChannel: "alipay"
      }, "http://store.test/api/public/orders");

      expect(result.order.status).toBe("pending_payment");
      expect(result.order.pickupUrl).toBe("https://pickup.test/self-service");

      const publicPending = getPublicOrder(ctx, result.order.id);
      expect(publicPending?.pickupUrl).toBeNull();
      expect(publicPending?.pickupOpenMode).toBe("none");

      const secret = ctx.db.query("SELECT peerpay_callback_secret AS secret FROM orders WHERE id = ?").get(result.order.id) as { secret: string };
      const payload = {
        orderId: result.order.peerpayOrderId!,
        merchantOrderId: result.order.id,
        paymentAccountCode: "alipay-a",
        paymentChannel: "alipay" as const,
        status: "paid",
        requestedAmount: "12.00",
        actualAmount: "12.00",
        paidAt: "2026-05-04T00:00:00.000Z"
      };
      const sign = signPeerPayPayload(payload, secret.secret);
      await handlePeerPayCallback(ctx, { ...payload, sign }, sign);

      const publicPaid = getPublicOrder(ctx, result.order.id);
      expect(publicPaid?.status).toBe("needs_manual");
      expect(publicPaid?.pickupUrl).toBe("https://pickup.test/self-service");
      expect(publicPaid?.pickupOpenMode).toBe("iframe");
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
    let stockCalls = 0;
    let precheckBody = "";
    const restoreFetch = mockFetch(async (url, init) => {
      if (url.origin === "https://upstream.test" && url.pathname === "/precheck") {
        precheckCalls += 1;
        precheckBody = String(init?.body ?? "");
        return Response.json({ ok: false });
      }
      if (url.origin === "https://upstream.test" && url.pathname === "/stock") {
        stockCalls += 1;
        return Response.json({ ok: true, stock: 10 });
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
        stock: {
          enabled: true,
          method: "GET",
          url: "https://upstream.test/stock",
          stockPath: "stock",
          minStock: 1
        },
        order: { enabled: true, url: "https://upstream.test/order" }
      }
    });

    try {
      const list = await listPublicProducts(ctx);
      expect(precheckCalls).toBe(0);
      expect(stockCalls).toBe(0);
      expect(list[0]?.available).toBe(true);
      expect(list[0]?.availabilityReason).toBeNull();
      expect(list[0]?.deliveryMode).toBe("manual");
      expect(list[0]?.upstreamConfig).toBeNull();

      const detail = await getPublicProduct(ctx, "detail-precheck");
      expect(precheckCalls).toBe(1);
      expect(stockCalls).toBe(0);
      expect(precheckBody).toBe("password=&num=1&captcha=&item_id=7");
      expect(detail?.available).toBe(false);
      expect(detail?.availabilityReason).toBe("无库存");
      expect(detail?.deliveryMode).toBe("manual");
      expect(detail?.upstreamConfig).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("accepts string stock values from upstream stock checks", async () => {
    const ctx = createTestContext();
    let stockCalls = 0;
    const restoreFetch = mockFetch(async (url) => {
      if (url.origin === "https://upstream.test" && url.pathname === "/stock") {
        stockCalls += 1;
        return Response.json({ code: 200, data: { stock: "89", stock_state: 3 } });
      }
      return undefined;
    });
    createProduct(ctx, {
      title: "字符串库存商品",
      slug: "string-stock",
      price: "30.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        sku: "string-stock",
        stock: {
          enabled: true,
          method: "POST",
          url: "https://upstream.test/stock",
          stockPath: "data.stock",
          minStock: 1
        },
        order: { enabled: true, url: "https://upstream.test/order" }
      }
    });

    try {
      const products = await listPublicProducts(ctx);
      expect(products[0]?.available).toBe(true);
      expect(products[0]?.availabilityReason).toBeNull();
      expect(stockCalls).toBe(0);

      const product = await getPublicProductAvailability(ctx, "string-stock");
      expect(stockCalls).toBe(1);
      expect(product?.available).toBe(true);
      expect(product?.availabilityReason).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("fetches upstream captcha and sends captcha variables with upstream order", async () => {
    const ctx = createTestContext();
    let upstreamOrderBody = "";
    const restoreFetch = mockFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.origin === "https://upstream.test" && url.pathname === "/captcha") {
        return Response.json({ code: 200, data: { image: "data:image/png;base64,Y2FwdGNoYQ==", token: "captcha-token-001" } });
      }
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
        upstreamOrderBody = String(init?.body ?? "");
        return Response.json({ ok: true, data: { secret: "CAPTCHA-CARD-001" } });
      }
      return undefined;
    });
    createProduct(ctx, {
      title: "验证码上游",
      slug: "captcha-upstream",
      price: "30.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        sku: "captcha-sku",
        captcha: {
          enabled: true,
          method: "GET",
          url: "https://upstream.test/captcha",
          imageBase64Path: "data.image",
          tokenPath: "data.token"
        },
        order: {
          enabled: true,
          method: "POST",
          url: "https://upstream.test/order",
          bodyType: "form",
          body: {
            sku: "{{sku}}",
            captcha: "{{captcha}}",
            captchaToken: "{{captchaToken}}"
          },
          expect: { path: "ok", equals: true },
          deliveryPath: "data.secret"
        }
      }
    });

    try {
      const publicProduct = await getPublicProduct(ctx, "captcha-upstream");
      expect(publicProduct?.captchaRequired).toBe(true);

      const captcha = await getPublicProductCaptcha(ctx, "captcha-upstream");
      expect(captcha.imageBase64).toBe("Y2FwdGNoYQ==");
      expect(captcha.imageDataUrl).toBe("data:image/png;base64,Y2FwdGNoYQ==");
      expect(captcha.token).toBe("captcha-token-001");

      ctx.db.query("INSERT INTO app_settings(key, value, updated_at) VALUES ('peerpay_base_url', ?, ?)").run("http://peerpay.test", new Date().toISOString());
      const result = await createOrder(ctx, {
        slug: "captcha-upstream",
        contactValue: "buyer@example.com",
        paymentChannel: "alipay",
        captcha: "A7K9",
        captchaToken: captcha.token ?? undefined
      }, "http://store.test/api/public/orders");
      const secret = ctx.db.query("SELECT peerpay_callback_secret AS secret FROM orders WHERE id = ?").get(result.order.id) as { secret: string };
      const payload = {
        orderId: result.order.peerpayOrderId!,
        merchantOrderId: result.order.id,
        paymentAccountCode: "alipay-a",
        paymentChannel: "alipay" as const,
        status: "paid",
        requestedAmount: "30.00",
        actualAmount: "30.00",
        paidAt: "2026-05-04T00:00:00.000Z"
      };
      const sign = signPeerPayPayload(payload, secret.secret);
      const callback = await handlePeerPayCallback(ctx, { ...payload, sign }, sign);

      expect(callback.order.status).toBe("delivered");
      expect(callback.order.deliveryPayload).toBe("CAPTCHA-CARD-001");
      expect(upstreamOrderBody).toContain("captcha=A7K9");
      expect(upstreamOrderBody).toContain("captchaToken=captcha-token-001");
    } finally {
      restoreFetch();
    }
  });

  test("accepts direct base64 captcha responses without a token", async () => {
    const ctx = createTestContext();
    const restoreFetch = mockFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.origin === "https://upstream.test" && url.pathname === "/captcha-direct") {
        return new Response("Y2FwdGNoYQ==", { headers: { "content-type": "text/plain" } });
      }
      return undefined;
    });
    createProduct(ctx, {
      title: "直接验证码上游",
      slug: "captcha-direct-upstream",
      price: "30.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        captcha: {
          enabled: true,
          method: "GET",
          url: "https://upstream.test/captcha-direct"
        },
        order: {
          enabled: true,
          method: "POST",
          url: "https://upstream.test/order"
        }
      }
    });

    try {
      const captcha = await getPublicProductCaptcha(ctx, "captcha-direct-upstream");
      expect(captcha.imageBase64).toBe("Y2FwdGNoYQ==");
      expect(captcha.imageDataUrl).toBe("data:image/png;base64,Y2FwdGNoYQ==");
      expect(captcha.token).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  test("accepts direct binary image captcha responses without a token", async () => {
    const ctx = createTestContext();
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const restoreFetch = mockFetch(async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.origin === "https://upstream.test" && url.pathname === "/captcha-image") {
        return new Response(pngHeader, { headers: { "content-type": "image/PNG" } });
      }
      return undefined;
    });
    createProduct(ctx, {
      title: "图片验证码上游",
      slug: "captcha-image-upstream",
      price: "30.00",
      status: "active",
      deliveryMode: "upstream",
      upstreamConfig: {
        captcha: {
          enabled: true,
          method: "GET",
          url: "https://upstream.test/captcha-image"
        },
        order: {
          enabled: true,
          method: "POST",
          url: "https://upstream.test/order"
        }
      }
    });

    try {
      const captcha = await getPublicProductCaptcha(ctx, "captcha-image-upstream");
      expect(captcha.imageBase64).toBe("iVBORw0KGgo=");
      expect(captcha.imageDataUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
      expect(captcha.mimeType).toBe("image/png");
      expect(captcha.token).toBeNull();
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
      expect(() => updateOrderStatus(ctx, result.order.id, "cancelled", "后台取消")).toThrow("已发货订单不能变更状态");
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
