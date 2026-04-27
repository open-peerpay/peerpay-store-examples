import { expect, test } from "bun:test";

test("mock store exposes low priced products", async () => {
  const source = await Bun.file("server.ts").text();
  expect(source).toContain("贴纸包");
  expect(source).toContain("1.00");
  expect(source).toContain("/api/orders");
});
