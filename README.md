# PeerPay Store Examples

一个用于联调 PeerPay 的 mock store。它提供几个低价商品，店铺下单后会调用 PeerPay 的 `/api/orders` 创建支付订单，并在本地保存店铺订单，支持订单状态查询和 PeerPay 回调更新。

示例商品使用 `1.00`、`2.00`、`3.00` 这类整元小额金额。PeerPay 只有在请求金额为整元时才会启用金额偏移池；如果连续创建 `0.30` 这类非整元 pending 订单，后续同金额订单会因为金额已占用返回 `409`。

## 启动

先启动 PeerPay：

```bash
cd /Users/gareth/Workspace/peerpay
PORT=51828 bun run dev
```

再启动示例店铺：

```bash
cd /Users/gareth/Workspace/peerpay-store-examples
PEERPAY_BASE_URL=http://localhost:51828 PORT=5174 bun run dev
```

打开 `http://localhost:5174`，选择商品下单。返回的店铺订单号形如 `store_xxx`，可以在左侧输入框查询状态。

示例店铺创建订单时会为每笔订单随机生成 `callbackSecret`，传给 PeerPay 并保存在本地订单表。PeerPay 回调到 `POST /api/peerpay/callback` 时，店铺会按 `merchantOrderId` 找到对应密钥，并校验 body 里的 `sign` 或请求头 `x-peerpay-signature`。

## 接口

- `GET /api/products`：商品列表
- `POST /api/orders`：创建店铺订单并调用 PeerPay 创建支付订单
- `GET /api/orders/:id`：查询店铺订单状态
- `POST /api/peerpay/callback`：PeerPay 回调入口

PeerPay 单笔订单查询属于管理 API，示例店铺默认不持有管理登录态；店铺侧状态以本地订单和回调为准。
