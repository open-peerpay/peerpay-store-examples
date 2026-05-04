import app from "../public/index.html";
import { corsHeaders, json } from "./http";
import { createApiRoutes } from "./routes";
import { createAppContext } from "./services";

export function startServer() {
  const ctx = createAppContext();
  const port = Number(Bun.env.PORT ?? 3000);
  const adminPath = normalizeAdminPath(Bun.env.ADMIN_PATH ?? "/admin");
  const server = Bun.serve({
    port,
    development: Bun.env.NODE_ENV === "production" ? false : {
      hmr: true,
      console: true
    },
    routes: {
      "/": app as never,
      "/orders": app as never,
      "/orders/:id": app as never,
      [adminPath]: app as never,
      [`${adminPath}/`]: app as never,
      ...createApiRoutes(ctx)
    },
    fetch(req) {
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "接口不存在" }, { status: 404 });
      }

      return new Response("Not Found", { status: 404 });
    }
  });

  console.log(`PeerPay Store listening on ${server.url}`);
  console.log(`PeerPay Store admin: ${new URL(adminPath, server.url).toString()}`);
  return server;
}

function normalizeAdminPath(value: string) {
  const path = value.startsWith("/") ? value : `/${value}`;
  if (!/^\/[a-zA-Z0-9_-]{2,80}$/.test(path)) {
    throw new Error("ADMIN_PATH 只能包含 2-80 位字母、数字、下划线或短横线");
  }
  return path;
}

if (import.meta.main) {
  startServer();
}
