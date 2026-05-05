import {
  getAdminSessionState,
  loginAdmin,
  logoutAdminCookie,
  requireAdmin,
  setupAdminPassword
} from "./auth";
import { boolFromBody, json, pageOptions, readJson, withErrors } from "./http";
import {
  addCards,
  createOrder,
  createProduct,
  dashboardStats,
  findOrdersByContact,
  getOrder,
  getPublicProduct,
  getStoreSettings,
  handlePeerPayCallback,
  listCards,
  listOrders,
  listProducts,
  listPublicProducts,
  listSystemLogs,
  setProductStatus,
  saveUploadedImage,
  updateOrderStatus,
  updateProduct,
  updateStoreSettings,
  uploadedImageResponse,
  type AppContext
} from "./services";
import type {
  AddCardsInput,
  CreateOrderInput,
  CreateProductInput,
  OrderStatus,
  ProductStatus,
  UpdateProductInput
} from "../src/shared/types";

type RouteRequest<T extends Record<string, string> = Record<string, string>> = Request & {
  params: T;
};

function admin<T extends Request>(ctx: AppContext, req: T, handler: () => Response | Promise<Response>) {
  requireAdmin(ctx, req);
  return handler();
}

export function createApiRoutes(ctx: AppContext) {
  return {
    "/api/health": {
      GET: () => json({ ok: true, time: new Date().toISOString() })
    },
    "/api/admin/session": {
      GET: (req: Request) => withErrors(() => json(getAdminSessionState(ctx, req)))
    },
    "/api/admin/setup": {
      POST: (req: Request) => withErrors(async () => {
        const body = await readJson<{ password?: string }>(req);
        const cookie = await setupAdminPassword(ctx, body.password ?? "");
        return json({ ...getAdminSessionState(ctx, req), authenticated: true, setupRequired: false }, { headers: { "set-cookie": cookie } });
      })
    },
    "/api/admin/login": {
      POST: (req: Request) => withErrors(async () => {
        const body = await readJson<{ password?: string }>(req);
        const cookie = await loginAdmin(ctx, body.password ?? "");
        return json({ ...getAdminSessionState(ctx, req), authenticated: true }, { headers: { "set-cookie": cookie } });
      })
    },
    "/api/admin/logout": {
      POST: () => withErrors(() => json({ ok: true }, { headers: { "set-cookie": logoutAdminCookie() } }))
    },
    "/api/admin/dashboard": {
      GET: (req: Request) => withErrors(() => admin(ctx, req, () => json(dashboardStats(ctx))))
    },
    "/api/admin/settings": {
      GET: (req: Request) => withErrors(() => admin(ctx, req, () => json(getStoreSettings(ctx)))),
      POST: (req: Request) => withErrors(async () => admin(ctx, req, async () => json(updateStoreSettings(ctx, await readJson(req)))))
    },
    "/api/admin/uploads": {
      POST: (req: Request) => withErrors(async () => admin(ctx, req, async () => {
        const form = await req.formData();
        return json(await saveUploadedImage(form.get("file")), { status: 201 });
      }))
    },
    "/api/admin/products": {
      GET: (req: Request) => withErrors(() => admin(ctx, req, () => json(listProducts(ctx)))),
      POST: (req: Request) => withErrors(async () => admin(ctx, req, async () => {
        const product = createProduct(ctx, await readJson<CreateProductInput>(req));
        return json(product, { status: 201 });
      }))
    },
    "/api/admin/products/:id": {
      POST: (req: RouteRequest<{ id: string }>) => withErrors(async () => admin(ctx, req, async () => {
        return json(updateProduct(ctx, Number(req.params.id), await readJson<UpdateProductInput>(req)));
      }))
    },
    "/api/admin/products/:id/status": {
      POST: (req: RouteRequest<{ id: string }>) => withErrors(async () => admin(ctx, req, async () => {
        const body = await readJson<{ status?: ProductStatus; active?: unknown }>(req);
        const status = body.status ?? (boolFromBody(body.active, "active") ? "active" : "archived");
        return json(setProductStatus(ctx, Number(req.params.id), status));
      }))
    },
    "/api/admin/products/:id/cards": {
      GET: (req: RouteRequest<{ id: string }>) => withErrors(() => admin(ctx, req, () => json(listCards(ctx, Number(req.params.id))))),
      POST: (req: RouteRequest<{ id: string }>) => withErrors(async () => admin(ctx, req, async () => {
        return json(addCards(ctx, Number(req.params.id), await readJson<AddCardsInput>(req)), { status: 201 });
      }))
    },
    "/api/admin/orders": {
      GET: (req: Request) => withErrors(() => admin(ctx, req, () => {
        const url = new URL(req.url);
        return json(listOrders(ctx, { ...pageOptions(url), status: url.searchParams.get("status") }));
      }))
    },
    "/api/admin/orders/:id/status": {
      POST: (req: RouteRequest<{ id: string }>) => withErrors(async () => admin(ctx, req, async () => {
        const body = await readJson<{ status: OrderStatus; manualReason?: string; deliveryPayload?: string }>(req);
        return json(updateOrderStatus(ctx, req.params.id, body.status, body.manualReason, body.deliveryPayload));
      }))
    },
    "/api/admin/logs": {
      GET: (req: Request) => withErrors(() => admin(ctx, req, () => {
        const url = new URL(req.url);
        return json(listSystemLogs(ctx, { ...pageOptions(url), level: url.searchParams.get("level") }));
      }))
    },
    "/api/public/store": {
      GET: () => withErrors(async () => json({ settings: getStoreSettings(ctx), products: await listPublicProducts(ctx) }))
    },
    "/api/public/products/:slug": {
      GET: (req: RouteRequest<{ slug: string }>) => withErrors(async () => json(await getPublicProduct(ctx, req.params.slug)))
    },
    "/api/public/orders": {
      GET: (req: Request) => withErrors(() => {
        const url = new URL(req.url);
        const contactValue = url.searchParams.get("contact") ?? "";
        if (!contactValue) {
          return json([]);
        }
        return json(findOrdersByContact(ctx, contactValue));
      }),
      POST: (req: Request) => withErrors(async () => {
        const result = await createOrder(ctx, await readJson<CreateOrderInput>(req), req.url);
        return json(result, { status: 201 });
      })
    },
    "/api/public/orders/:id": {
      GET: (req: RouteRequest<{ id: string }>) => withErrors(() => json(getOrder(ctx, req.params.id)))
    },
    "/api/payments/peerpay/callback": {
      POST: (req: Request) => withErrors(async () => {
        const result = await handlePeerPayCallback(ctx, await readJson(req), req.headers.get("x-peerpay-signature"));
        return json(result);
      })
    },
    "/uploads/:name": {
      GET: (req: RouteRequest<{ name: string }>) => withErrors(() => uploadedImageResponse(req.params.name))
    }
  };
}
