# PeerPay Store

PeerPay Store 是一个基于 Bun fullstack dev server、React、Ant Design 和内置 SQLite 的开源一口价店铺。它面向轻量售卖场景：商品上架、匿名下单、卡密自动发货、动态上游取货、自助提货和订单查询。

## 功能

- `/` 默认商品首页，用户不需要登录，点击商品弹窗查看详情并下单，提交后跳转 PeerPay 付款页。
- `/admin` 管理后台，首次部署会要求设置管理员密码。
- 后台支持上架一口价商品、配置卡密库存、动态上游取货、提货网站打开方式、PeerPay 地址和飞书 Webhook。
- 订单支持用一个字符串查询，提示用户可填写手机号、QQ 或邮箱；本机下过的订单号会记录在 IndexedDB，再通过数据库接口查询详情。
- 卡密商品在 PeerPay 支付回调后自动发货；动态商品支持预检测、库存查询、支付后上游下单和字段提取。
- 上游不可用时，预检测不通过或无库存会显示无货；已经进入上游下单后，如果请求失败或返回不一致，会把订单标记为人工介入并通知飞书。
- 提货网站可以配置为新标签打开或 iframe 内嵌。

## 技术栈

- Bun fullstack dev server：同一进程提供 HTML bundle 和 `/api/*` 路由。
- SQLite：使用 `bun:sqlite`，默认数据库为 `data/peerpay-store.sqlite`。
- React + Ant Design：后台参考 PeerPay 后台风格，商店页参考 PeerPay 支付页风格。

## 快速开始

```bash
bun install
bun run dev
```

默认地址：

- 商店首页：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin`

如果 3000 端口被占用：

```bash
PORT=49153 bun run dev
```

## 环境变量

```bash
PORT=3000
DATABASE_URL=./data/peerpay-store.sqlite
NODE_ENV=production
ADMIN_PATH=/admin
PEERPAY_BASE_URL=https://peerpay.example.com
PEERPAY_PAYMENT_CHANNEL=alipay
PEERPAY_TTL_MINUTES=15
STORE_BASE_URL=https://store.example.com
```

## PeerPay 支付配置

PeerPay 服务地址需要通过后台“商店配置”或环境变量 `PEERPAY_BASE_URL` 配置。仓库里只保留脱敏示例值，生产部署时请改成自己的 PeerPay 访问地址。

Store 创建业务订单后，会由后端调用 PeerPay `/api/orders` 创建支付订单，并传入：

- `merchantOrderId`：本地业务订单号。
- `callbackUrl`：`/api/payments/peerpay/callback`。
- `callbackSecret`：每个业务订单随机生成，保存在 SQLite。
- `redirectUrl`：`/orders/:id`，用户从 PeerPay 支付页返回后查看订单。

PeerPay 回调通过 HMAC-SHA256 验签后，Store 才会把订单从 `pending_payment` 更新为 `paid`，并执行卡密发货或动态上游取货。生产环境建议在后台配置 `Store 公开访问地址`，确保 PeerPay 可以访问回调 URL。

## 首页广告配置

后台“广告配置”是可视化编辑页面。每条广告支持标题、正文、按钮文案、点击跳转地址，也可以上传 PNG、JPG、WEBP 或 GIF 图片。商店首页会自动轮换展示广告。

```json
[
  {
    "title": "自动发货库存已补充",
    "body": "卡密商品付款后即时发货，可在订单里自助查看。",
    "imageUrl": "https://example.com/banner.jpg",
    "linkUrl": "https://example.com",
    "linkText": "查看详情"
  }
]
```

## 动态上游配置

后台商品发货方式选择“动态上游取货”时，才会显示“动态上游配置 JSON”。配置支持模板变量：

- `{{productId}}`
- `{{productSlug}}`
- `{{productTitle}}`
- `{{sku}}`
- `{{token}}`
- `{{price}}`
- `{{orderId}}`
- `{{contactType}}`
- `{{contact}}`
- `{{amount}}`

示例：

```json
{
  "sku": "demo-sku",
  "token": "secret-token",
  "precheck": {
    "enabled": true,
    "method": "GET",
    "url": "https://upstream.example/api/precheck?sku={{sku}}",
    "expect": { "path": "ok", "equals": true }
  },
  "stock": {
    "enabled": true,
    "method": "GET",
    "url": "https://upstream.example/api/stock?sku={{sku}}",
    "stockPath": "data.stock",
    "minStock": 1
  },
  "order": {
    "enabled": true,
    "method": "POST",
    "url": "https://upstream.example/api/orders",
    "headers": { "authorization": "Bearer {{token}}" },
    "body": {
      "sku": "{{sku}}",
      "orderId": "{{orderId}}",
      "contact": "{{contact}}"
    },
    "successPath": "code",
    "successEquals": 0,
    "deliveryPath": "data.secret",
    "remoteOrderIdPath": "data.orderId"
  }
}
```

## 常用脚本

```bash
bun run dev        # 开发服务
bun test           # 单元测试
bun run typecheck  # TypeScript 检查
bun run build      # 生产构建
bun run build:bin  # 构建 Linux x64 单文件可执行程序
bun run publish root@your-server  # 编译并发布到 /home/peerpay-store
```

`publish` 会参考 PeerPay 后端的部署方式：编译 `dist/peerpay-store`，上传到远端 `/home/peerpay-store/peerpay-store`，并在远端不存在 `ecosystem.config.js` 时上传 PM2 配置。生产环境需要在服务器上准备环境变量，例如 `PEERPAY_BASE_URL`、`STORE_BASE_URL`、`ADMIN_PATH` 和 `DATABASE_URL`。
