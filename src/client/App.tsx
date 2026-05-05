import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  App as AntApp,
  Button,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Radio,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  Upload
} from "antd";
import type { MenuProps, TableProps } from "antd";
import {
  AlipayCircleOutlined,
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BellOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  LinkOutlined,
  LockOutlined,
  MenuOutlined,
  MessageOutlined,
  NotificationOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  UploadOutlined,
  WechatOutlined
} from "@ant-design/icons";
import {
  DEFAULT_UPSTREAM_CONFIG_EXAMPLE,
  DELIVERY_MODE_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_CHANNEL_LABELS,
  PICKUP_OPEN_MODE_LABELS,
  PRODUCT_STATUS_LABELS
} from "../shared/constants";
import type {
  AdminSessionState,
  DeliveryMode,
  HttpBodyType,
  HttpExpectation,
  Order,
  PaymentChannel,
  PickupOpenMode,
  Product,
  ProductStatus,
  PublicProduct,
  StoreAd,
  StoreSettings,
  SystemLog,
  UpstreamConfig,
  UpstreamHttpRequest,
  UpstreamOrderRequest,
  UpstreamStockRequest
} from "../shared/types";
import {
  addProductCards,
  createProduct,
  createPublicOrder,
  getAdminSession,
  listProductCards,
  loadAdminSnapshot,
  loadPublicOrder,
  loadPublicProduct,
  loadPublicStore,
  loginAdmin,
  logoutAdmin,
  saveSettings,
  searchOrders,
  setProductStatus,
  setupAdmin,
  updateOrderStatus,
  updateProduct,
  uploadImage,
  type AdminSnapshot
} from "./api";

type ViewKey = "dashboard" | "products" | "orders" | "store-settings" | "ad-settings" | "notification-settings" | "logs";
type Columns<T> = NonNullable<TableProps<T>["columns"]>;

const { Header, Sider, Content } = Layout;
const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

const emptySnapshot: AdminSnapshot = {
  dashboard: {
    products: { total: 0, active: 0, cardStock: 0 },
    orders: { total: 0, delivered: 0, needsManual: 0, today: 0 }
  },
  settings: {
    feishuWebhookUrl: null,
    storeName: "PeerPay Store",
    storeNotice: "",
    ads: [],
    peerpayBaseUrl: null,
    storeBaseUrl: null,
    peerpayPaymentChannel: "alipay",
    peerpayTtlMinutes: 15
  },
  products: [],
  orders: { items: [], total: 0, limit: 100, offset: 0 },
  logs: { items: [], total: 0, limit: 80, offset: 0 }
};

const menuItems: MenuProps["items"] = [
  { key: "dashboard", icon: <AppstoreOutlined />, label: "仪表盘" },
  { key: "products", icon: <ShopOutlined />, label: "商品上架" },
  { key: "orders", icon: <ShoppingCartOutlined />, label: "订单管理" },
  { key: "store-settings", icon: <SettingOutlined />, label: "商店配置" },
  { key: "ad-settings", icon: <PictureOutlined />, label: "广告配置" },
  { key: "notification-settings", icon: <NotificationOutlined />, label: "通知配置" },
  { key: "logs", icon: <FileSearchOutlined />, label: "系统日志" }
];

const viewTitles: Record<ViewKey, string> = {
  dashboard: "仪表盘",
  products: "商品上架",
  orders: "订单管理",
  "store-settings": "商店配置",
  "ad-settings": "广告配置",
  "notification-settings": "通知配置",
  logs: "系统日志"
};

const ADMIN_VIEW_STORAGE_KEY = "peerpay-store:admin-view:v1";
const ADMIN_VIEW_KEYS = new Set<ViewKey>(Object.keys(viewTitles) as ViewKey[]);

const statusColor: Record<string, string> = {
  pending_payment: "gold",
  active: "success",
  draft: "default",
  archived: "error",
  paid: "processing",
  delivered: "success",
  needs_manual: "warning",
  failed: "error",
  cancelled: "default",
  card: "green",
  upstream: "blue",
  manual: "orange",
  info: "blue",
  warn: "gold",
  error: "red"
};

const AD_GRADIENT_START_COLOR = "#fffdf7";
const DEFAULT_AD_GRADIENT_COLOR = "#f0c84b";
const IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HTTP_METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH"].map((value) => ({ value, label: value }));
const BODY_TYPE_OPTIONS: Array<{ value: HttpBodyType; label: string }> = [
  { value: "json", label: "JSON" },
  { value: "form", label: "x-www-form-urlencoded" },
  { value: "raw", label: "Raw" }
];
const EXPECT_MODE_OPTIONS = [
  { value: "truthy", label: "真值通过" },
  { value: "equals", label: "等于" },
  { value: "exists", label: "存在" },
  { value: "missing", label: "不存在" }
];
const SCALAR_VALUE_TYPE_OPTIONS = [
  { value: "string", label: "字符串" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "布尔" },
  { value: "json", label: "JSON" }
];
type AdGradientStyle = CSSProperties & {
  "--ad-gradient-start": string;
  "--ad-gradient-color": string;
};
type UpstreamRequestKey = "precheck" | "stock" | "order";
type ExpectMode = "truthy" | "equals" | "exists" | "missing";
type ScalarValueType = "string" | "number" | "boolean" | "json";

interface UpstreamRequestFormValue {
  enabled?: boolean;
  method?: UpstreamHttpRequest["method"];
  url?: string;
  timeoutMs?: number;
  headersText?: string;
  bodyType?: HttpBodyType;
  bodyText?: string;
  expectMode?: ExpectMode;
  expectPath?: string;
  expectEquals?: string;
  expectEqualsType?: ScalarValueType;
  stockPath?: string;
  minStock?: number;
  availablePath?: string;
  availableEquals?: string;
  availableEqualsType?: ScalarValueType;
  successPath?: string;
  successEquals?: string;
  successEqualsType?: ScalarValueType;
  deliveryPath?: string;
  remoteOrderIdPath?: string;
}

interface UpstreamConfigFormValue {
  sku?: string;
  token?: string;
  precheck?: UpstreamRequestFormValue;
  stock?: UpstreamRequestFormValue;
  order?: UpstreamRequestFormValue;
}

function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 8,
          colorPrimary: "#2563eb",
          fontFamily: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif'
        }
      }}
    >
      <AntApp>{isAdmin ? <AdminApp /> : <Storefront />}</AntApp>
    </ConfigProvider>
  );
}

function AdminApp() {
  const { message } = AntApp.useApp();
  const [session, setSession] = useState<AdminSessionState | null>(null);

  const refreshSession = useCallback(() => {
    getAdminSession().then(setSession).catch((error) => message.error(error.message));
  }, [message]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  if (!session) {
    return <div className="auth-page" />;
  }

  if (session.setupRequired || !session.authenticated) {
    return <AuthPage setupRequired={session.setupRequired} onDone={refreshSession} />;
  }

  return <AdminShell onLogout={async () => {
    await logoutAdmin();
    refreshSession();
  }} />;
}

function AuthPage({ setupRequired, onDone }: { setupRequired: boolean; onDone: () => void }) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <Brand compact />
        <Title level={3}>{setupRequired ? "初始化管理员密码" : "登录管理后台"}</Title>
        <Form
          layout="vertical"
          onFinish={async (values) => {
            setLoading(true);
            try {
              if (setupRequired) {
                await setupAdmin(values.password);
              } else {
                await loginAdmin(values.password);
              }
              onDone();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "操作失败");
            } finally {
              setLoading(false);
            }
          }}
        >
          <Form.Item name="password" label="管理密码" rules={[{ required: true, min: 8 }]}>
            <Input.Password prefix={<LockOutlined />} size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            {setupRequired ? "完成初始化" : "登录"}
          </Button>
        </Form>
      </section>
    </main>
  );
}

function toViewKey(value: unknown): ViewKey | null {
  return typeof value === "string" && ADMIN_VIEW_KEYS.has(value as ViewKey) ? value as ViewKey : null;
}

function readRememberedAdminView(): ViewKey {
  try {
    return toViewKey(window.localStorage.getItem(ADMIN_VIEW_STORAGE_KEY)) ?? "dashboard";
  } catch {
    return "dashboard";
  }
}

function rememberAdminView(view: ViewKey) {
  try {
    window.localStorage.setItem(ADMIN_VIEW_STORAGE_KEY, view);
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

function AdminShell({ onLogout }: { onLogout: () => void }) {
  const { message } = AntApp.useApp();
  const [view, setView] = useState<ViewKey>(readRememberedAdminView);
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [loading, setLoading] = useState(false);
  const [productDrawer, setProductDrawer] = useState<Product | "new" | null>(null);
  const [cardsProduct, setCardsProduct] = useState<Product | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await loadAdminSnapshot());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectView = useCallback((nextView: ViewKey) => {
    setView(nextView);
    rememberAdminView(nextView);
    setMobileMenuOpen(false);
  }, []);

  const menu = (
    <>
      <Brand />
      <Menu
        mode="inline"
        selectedKeys={[view]}
        items={menuItems}
        onClick={(item) => {
          const nextView = toViewKey(item.key);
          if (nextView) {
            selectView(nextView);
          }
        }}
      />
    </>
  );

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" theme="light" width={236}>{menu}</Sider>
      <Drawer open={mobileMenuOpen} placement="left" onClose={() => setMobileMenuOpen(false)} size={276} title={null}>
        {menu}
      </Drawer>
      <Layout>
        <Header className="app-header">
          <div className="app-title-row">
            <Button className="mobile-menu-button" icon={<MenuOutlined />} onClick={() => setMobileMenuOpen(true)} />
            <div>
              <Title level={3}>{viewTitles[view]}</Title>
            </div>
          </div>
          <Space wrap className="app-toolbar">
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
            <Button onClick={onLogout}>退出</Button>
          </Space>
        </Header>
        <Content className="app-content">
          {view === "dashboard" && <DashboardView snapshot={snapshot} />}
          {view === "products" && (
            <ProductsView
              products={snapshot.products}
              loading={loading}
              onCreate={() => setProductDrawer("new")}
              onEdit={setProductDrawer}
              onCards={setCardsProduct}
              onStatus={async (product, status) => {
                await setProductStatus(product.id, status);
                await refresh();
              }}
            />
          )}
          {view === "orders" && <OrdersView orders={snapshot.orders.items} loading={loading} onChange={refresh} />}
          {view === "store-settings" && <StoreSettingsView settings={snapshot.settings} onSaved={refresh} />}
          {view === "ad-settings" && <AdSettingsView settings={snapshot.settings} onSaved={refresh} />}
          {view === "notification-settings" && <NotificationSettingsView settings={snapshot.settings} onSaved={refresh} />}
          {view === "logs" && <LogsView logs={snapshot.logs.items} loading={loading} />}
        </Content>
      </Layout>
      <ProductDrawer
        product={productDrawer}
        open={Boolean(productDrawer)}
        onClose={() => setProductDrawer(null)}
        onSaved={async () => {
          setProductDrawer(null);
          await refresh();
        }}
      />
      <CardsDrawer
        product={cardsProduct}
        open={Boolean(cardsProduct)}
        onClose={() => setCardsProduct(null)}
        onSaved={refresh}
      />
    </Layout>
  );
}

function DashboardView({ snapshot }: { snapshot: AdminSnapshot }) {
  const metrics = [
    { title: "商品总数", value: snapshot.dashboard.products.total, tone: "blue" },
    { title: "已上架", value: snapshot.dashboard.products.active, tone: "green" },
    { title: "卡密库存", value: snapshot.dashboard.products.cardStock, tone: "amber" },
    { title: "需人工介入", value: snapshot.dashboard.orders.needsManual, tone: "red" }
  ];
  return (
    <div className="view-stack">
      <div className="metrics-grid">
        {metrics.map((metric) => (
          <section className={`metric metric-${metric.tone}`} key={metric.title}>
            <Statistic title={metric.title} value={metric.value} />
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <Title level={4}>订单概览</Title>
        </div>
        <div className="settings-grid">
          <InfoCell label="订单总量" value={snapshot.dashboard.orders.total} />
          <InfoCell label="今日下单" value={snapshot.dashboard.orders.today} />
          <InfoCell label="已发货" value={snapshot.dashboard.orders.delivered} />
          <InfoCell label="异常订单" value={snapshot.dashboard.orders.needsManual} />
        </div>
      </section>
    </div>
  );
}

function ProductsView({
  products,
  loading,
  onCreate,
  onEdit,
  onCards,
  onStatus
}: {
  products: Product[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (product: Product) => void;
  onCards: (product: Product) => void;
  onStatus: (product: Product, status: ProductStatus) => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const columns: Columns<Product> = [
    { title: "商品", dataIndex: "title", render: (_, item) => <ProductTitle product={item} /> },
    { title: "价格", dataIndex: "price", width: 110, render: (value) => `¥${value}` },
    { title: "状态", dataIndex: "status", width: 100, render: (value: ProductStatus) => <StatusTag value={value} text={PRODUCT_STATUS_LABELS[value]} /> },
    { title: "发货", dataIndex: "deliveryMode", width: 140, render: (value: DeliveryMode) => <StatusTag value={value} text={DELIVERY_MODE_LABELS[value]} /> },
    { title: "库存", dataIndex: "availableStock", width: 100, render: (value, item) => item.deliveryMode === "card" ? value : "-" },
    {
      title: "操作",
      width: 260,
      render: (_, item) => (
        <Space wrap>
          <Button size="small" onClick={() => onEdit(item)}>编辑</Button>
          <Button size="small" onClick={() => onCards(item)} disabled={item.deliveryMode !== "card"}>卡密</Button>
          <Switch
            checked={item.status === "active"}
            checkedChildren="上架"
            unCheckedChildren="下架"
            onChange={async (checked) => {
              try {
                await onStatus(item, checked ? "active" : "archived");
              } catch (error) {
                message.error(error instanceof Error ? error.message : "状态更新失败");
              }
            }}
          />
        </Space>
      )
    }
  ];

  return (
    <div className="view-stack">
      <div className="page-heading">
        <div>
          <Title level={4}>商品列表</Title>
          <Text type="secondary">一口价商品、卡密库存、动态上游取货和提货页打开方式都在这里配置。</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>新增商品</Button>
      </div>
      <section className="panel">
        <Table rowKey="id" loading={loading} columns={columns} dataSource={products} pagination={false} scroll={{ x: 980 }} />
      </section>
    </div>
  );
}

function OrdersView({ orders, loading, onChange }: { orders: Order[]; loading: boolean; onChange: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [deliveryOrder, setDeliveryOrder] = useState<Order | null>(null);

  const handleDeliver = async (item: Order) => {
    if (shouldFillDeliveryPayload(item)) {
      setDeliveryOrder(item);
      return;
    }
    try {
      await updateOrderStatus(item.id, "delivered", "后台标记已处理");
      await onChange();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新失败");
    }
  };

  const columns: Columns<Order> = [
    { title: "订单号", dataIndex: "id", width: 190, render: (value) => <Text copyable>{value}</Text> },
    { title: "商品", dataIndex: "productTitle", render: (value, item) => <div><strong>{value}</strong><br /><Text type="secondary">¥{item.amount}</Text></div> },
    { title: "联系方式", dataIndex: "contactValue" },
    { title: "支付", dataIndex: "peerpayPaymentChannel", width: 100, render: renderPaymentChannel },
    { title: "备注", dataIndex: "remark", width: 220, ellipsis: true, render: (value: string | null) => value || <Text type="secondary">-</Text> },
    { title: "状态", dataIndex: "status", width: 120, render: (value) => <StatusTag value={value} text={ORDER_STATUS_LABELS[value as keyof typeof ORDER_STATUS_LABELS]} /> },
    { title: "时间", dataIndex: "createdAt", width: 180, render: formatDate },
    {
      title: "操作",
      width: 210,
      render: (_, item) => (
        <Space wrap>
          <Button size="small" disabled={item.status === "delivered"} onClick={() => handleDeliver(item)}>
            {shouldFillDeliveryPayload(item) ? "填写发货" : "标记已处理"}
          </Button>
          <Button size="small" danger disabled={item.status === "cancelled"} onClick={async () => {
            try {
              await updateOrderStatus(item.id, "cancelled", "后台取消");
              await onChange();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "更新失败");
            }
          }}>取消</Button>
        </Space>
      )
    }
  ];
  return (
    <>
      <section className="panel">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={orders}
          pagination={false}
          scroll={{ x: 1360 }}
          expandable={{ expandedRowRender: (order) => <OrderDetails order={order} /> }}
        />
      </section>
      <ManualDeliveryDrawer
        order={deliveryOrder}
        open={Boolean(deliveryOrder)}
        onClose={() => setDeliveryOrder(null)}
        onDelivered={async () => {
          setDeliveryOrder(null);
          await onChange();
        }}
      />
    </>
  );
}

function shouldFillDeliveryPayload(order: Order) {
  return order.deliveryMode === "manual" || order.status === "needs_manual";
}

function ManualDeliveryDrawer({ order, open, onClose, onDelivered }: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
  onDelivered: () => Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{ deliveryPayload: string }>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (order) {
      form.setFieldsValue({ deliveryPayload: order.deliveryPayload ?? "" });
      return;
    }
    form.resetFields();
  }, [form, order]);

  return (
    <Drawer
      title="填写发货内容"
      open={open}
      onClose={onClose}
      size={520}
      destroyOnHidden
      footer={(
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>确认发货</Button>
        </Space>
      )}
    >
      {order && (
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            setSubmitting(true);
            try {
              await updateOrderStatus(order.id, "delivered", "后台填写发货内容", values.deliveryPayload);
              message.success("发货内容已保存");
              await onDelivered();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "发货失败");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <div className="settings-grid drawer-action">
            <InfoCell label="订单号" value={order.id} />
            <InfoCell label="商品" value={order.productTitle} />
          </div>
          <Form.Item
            name="deliveryPayload"
            label="卡密或发货内容"
            rules={[{ required: true, whitespace: true, message: "请填写卡密或发货内容" }]}
          >
            <TextArea rows={8} placeholder="例如：卡号、卡密、兑换码或取货说明" />
          </Form.Item>
        </Form>
      )}
    </Drawer>
  );
}

function StoreSettingsView({ settings, onSaved }: { settings: StoreSettings; onSaved: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      storeName: settings.storeName,
      storeNotice: settings.storeNotice,
      peerpayBaseUrl: settings.peerpayBaseUrl,
      storeBaseUrl: settings.storeBaseUrl,
      peerpayPaymentChannel: settings.peerpayPaymentChannel,
      peerpayTtlMinutes: settings.peerpayTtlMinutes
    });
  }, [form, settings]);

  return (
    <section className="panel settings-panel">
      <Title level={4}>商店基础配置</Title>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            await saveSettings(normalizeStoreSettingsForm(values));
            message.success("设置已保存");
            await onSaved();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
          }
        }}
      >
        <Form.Item name="storeName" label="店铺名称" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="storeNotice" label="首页公告">
          <TextArea rows={3} />
        </Form.Item>
        <div className="form-grid">
          <Form.Item name="peerpayBaseUrl" label="PeerPay 服务地址" rules={[{ required: true }]}>
            <Input placeholder="https://peerpay.example.com" />
          </Form.Item>
          <Form.Item name="storeBaseUrl" label="Store 公开访问地址">
            <Input placeholder="https://store.example.com" />
          </Form.Item>
          <Form.Item name="peerpayPaymentChannel" label="默认付款方式">
            <Select options={[{ value: "alipay", label: "支付宝" }, { value: "wechat", label: "微信" }]} />
          </Form.Item>
          <Form.Item name="peerpayTtlMinutes" label="支付有效期">
            <InputNumber min={1} max={1440} precision={0} className="full-width" suffix="分钟" />
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit">保存设置</Button>
      </Form>
    </section>
  );
}

function AdSettingsView({ settings, onSaved }: { settings: StoreSettings; onSaved: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      ads: settings.ads?.length ? settings.ads : [emptyAd()]
    });
  }, [form, settings.ads]);

  return (
    <section className="panel settings-panel ad-settings-panel">
      <div className="page-heading ad-settings-heading">
        <div>
          <Title level={4}>首页广告配置</Title>
          <Text type="secondary">可视化维护轮播广告、上传图片，并配置点击后的跳转地址。</Text>
        </div>
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            const ads = form.getFieldValue("ads") as StoreAd[] | undefined;
            form.setFieldValue("ads", [...(ads ?? []), emptyAd()]);
          }}
        >
          新增广告
        </Button>
      </div>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            await saveSettings({ ads: normalizeAdsForm(values.ads) });
            message.success("广告配置已保存");
            await onSaved();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
          }
        }}
      >
        <Form.List name="ads">
          {(fields, { add, remove, move }) => (
            <div className="ad-editor-list">
              {!fields.length && (
                <div className="empty-orders">暂无广告，点击新增广告开始配置</div>
              )}
              {fields.map((field, index) => (
                <div className="ad-editor-card" key={field.key}>
                  <Form.Item noStyle shouldUpdate>
                    {({ getFieldValue }) => (
                      <AdPreview ad={getFieldValue(["ads", field.name]) as StoreAd | undefined} index={index} />
                    )}
                  </Form.Item>
                  <div className="ad-editor-fields">
                    <div className="ad-editor-toolbar">
                      <Text strong>广告 {index + 1}</Text>
                      <Space>
                        <Button aria-label="上移广告" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, index - 1)} />
                        <Button aria-label="下移广告" icon={<ArrowDownOutlined />} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)} />
                        <Button aria-label="删除广告" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      </Space>
                    </div>
                    <div className="form-grid">
                      <Form.Item {...field} name={[field.name, "title"]} label="广告标题" rules={[{ required: true, message: "请输入广告标题" }]}>
                        <Input placeholder="限时补货" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, "linkText"]} label="按钮文案">
                        <Input placeholder="立即查看" />
                      </Form.Item>
                    </div>
                    <Form.Item {...field} name={[field.name, "gradientColor"]} label="右侧渐变色" extra="广告背景会从左侧纸色渐变到这个颜色。">
                      <Input className="color-input" placeholder="#f0c84b" />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, "body"]} label="广告描述">
                      <TextArea rows={3} placeholder="自动发货商品已补充库存" />
                    </Form.Item>
                    <div className="form-grid">
                      <Form.Item {...field} name={[field.name, "imageUrl"]} label="图片">
                        <ImageUrlUploadField />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, "linkUrl"]} label="点击跳转地址">
                        <Input prefix={<LinkOutlined />} placeholder="https://example.com 或 /orders" />
                      </Form.Item>
                    </div>
                    <Space wrap>
                      <Button icon={<PlusOutlined />} onClick={() => add(emptyAd(), index + 1)}>在下方插入</Button>
                      <Form.Item noStyle shouldUpdate>
                        {({ getFieldValue }) => {
                          const linkUrl = getFieldValue(["ads", field.name, "linkUrl"]) as string | undefined;
                          return (
                            <Button icon={<GlobalOutlined />} disabled={!linkUrl} href={linkUrl} target="_blank">
                              预览跳转
                            </Button>
                          );
                        }}
                      </Form.Item>
                    </Space>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Form.List>
        <Button type="primary" htmlType="submit" className="settings-submit">保存广告</Button>
      </Form>
    </section>
  );
}

function NotificationSettingsView({ settings, onSaved }: { settings: StoreSettings; onSaved: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      feishuWebhookUrl: settings.feishuWebhookUrl
    });
  }, [form, settings.feishuWebhookUrl]);

  return (
    <section className="panel settings-panel">
      <Title level={4}>飞书通知配置</Title>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            await saveSettings(normalizeNotificationSettingsForm(values));
            message.success("通知配置已保存");
            await onSaved();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
          }
        }}
      >
        <Form.Item name="feishuWebhookUrl" label="飞书机器人 Webhook">
          <Input placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
        </Form.Item>
        <Button type="primary" htmlType="submit">保存通知配置</Button>
      </Form>
    </section>
  );
}

function AdPreview({ ad, index }: { ad?: StoreAd; index: number }) {
  const style = adGradientStyle(ad?.gradientColor);
  return (
    <div className="ad-preview-set">
      <div className="ad-preview-block">
        <span className="ad-preview-label">PC 端</span>
        <div className="ad-preview-frame ad-preview-frame-pc" style={style}>
          <AdPreviewCopy ad={ad} index={index} />
          <AdPreviewImage ad={ad} />
        </div>
      </div>
      <div className="ad-preview-block">
        <span className="ad-preview-label">移动端</span>
        <div className="ad-preview-frame ad-preview-frame-mobile" style={style}>
          <AdPreviewImage ad={ad} />
          <AdPreviewCopy ad={ad} index={index} />
        </div>
      </div>
    </div>
  );
}

function AdPreviewImage({ ad }: { ad?: StoreAd }) {
  return ad?.imageUrl ? (
    <div className="ad-preview-image" style={{ backgroundImage: `url(${ad.imageUrl})` }} />
  ) : (
    <div className="ad-preview-image ad-preview-empty"><PictureOutlined /></div>
  );
}

function AdPreviewCopy({ ad, index }: { ad?: StoreAd; index: number }) {
  return (
    <div className="ad-preview-copy">
      <span>广告 {index + 1}</span>
      <strong>{ad?.title || "广告标题"}</strong>
      <p>{ad?.body || "广告描述会显示在这里，用于首页轮播。"}</p>
      <em>{ad?.linkText || "点击文案"}</em>
    </div>
  );
}

function LogsView({ logs, loading }: { logs: SystemLog[]; loading: boolean }) {
  const columns: Columns<SystemLog> = [
    { title: "级别", dataIndex: "level", width: 90, render: (value) => <StatusTag value={value} text={value} /> },
    { title: "动作", dataIndex: "action", width: 180 },
    { title: "消息", dataIndex: "message" },
    { title: "时间", dataIndex: "createdAt", width: 180, render: formatDate }
  ];
  return (
    <section className="panel">
      <Table rowKey="id" loading={loading} columns={columns} dataSource={logs} pagination={false} scroll={{ x: 900 }} />
    </section>
  );
}

function ProductDrawer({ product, open, onClose, onSaved }: { product: Product | "new" | null; open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const isNew = product === "new";

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!product || product === "new") {
      form.setFieldsValue({
        status: "draft",
        deliveryMode: "card",
        pickupOpenMode: "none",
        sortOrder: 100,
        upstreamConfig: upstreamConfigToForm(DEFAULT_UPSTREAM_CONFIG_EXAMPLE)
      });
      return;
    }
    form.setFieldsValue({
      ...product,
      price: Number(product.price),
      upstreamConfig: upstreamConfigToForm(product.upstreamConfig ?? DEFAULT_UPSTREAM_CONFIG_EXAMPLE)
    });
  }, [form, open, product]);

  return (
    <Drawer
      title={isNew ? "新增商品" : "编辑商品"}
      open={open}
      onClose={onClose}
      size={720}
      destroyOnHidden
      footer={<Button type="primary" onClick={() => form.submit()}>保存商品</Button>}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          try {
            const payload = normalizeProductForm(values);
            if (product && product !== "new") {
              await updateProduct(product.id, payload);
            } else {
              await createProduct(payload);
            }
            message.success("商品已保存");
            await onSaved();
          } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
          }
        }}
      >
        <div className="form-grid">
          <Form.Item name="title" label="商品标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="slug" label="URL 标识">
            <Input placeholder="auto-card" />
          </Form.Item>
          <Form.Item name="price" label="一口价" rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} step={1} prefix="¥" className="full-width" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} precision={0} className="full-width" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={statusOptions(PRODUCT_STATUS_LABELS)} />
          </Form.Item>
          <Form.Item name="deliveryMode" label="发货方式">
            <Select options={statusOptions(DELIVERY_MODE_LABELS)} />
          </Form.Item>
        </div>
        <Form.Item name="description" label="商品描述">
          <TextArea rows={4} />
        </Form.Item>
        <Form.Item name="coverUrl" label="封面图">
          <ImageUrlUploadField placeholder="上传封面图后自动填入，也可以粘贴图片 URL" uploadText="上传封面图" />
        </Form.Item>
        <div className="form-grid">
          <Form.Item name="pickupUrl" label="提货网站 URL">
            <Input />
          </Form.Item>
          <Form.Item name="pickupOpenMode" label="提货打开方式">
            <Select options={statusOptions(PICKUP_OPEN_MODE_LABELS)} />
          </Form.Item>
        </div>
        <Form.Item noStyle shouldUpdate={(prev, current) => prev.deliveryMode !== current.deliveryMode}>
          {({ getFieldValue }) => getFieldValue("deliveryMode") === "upstream" ? (
            <UpstreamConfigEditor />
          ) : null}
        </Form.Item>
      </Form>
    </Drawer>
  );
}

function UpstreamConfigEditor() {
  return (
    <section className="upstream-editor">
      <div className="upstream-editor-heading">
        <div>
          <Text strong>动态上游配置</Text>
          <Text type="secondary">按预检测、库存查询和支付后下单三段维护。</Text>
        </div>
      </div>
      <div className="form-grid">
        <Form.Item name={["upstreamConfig", "sku"]} label="SKU">
          <Input placeholder="demo-sku" />
        </Form.Item>
        <Form.Item name={["upstreamConfig", "token"]} label="Token">
          <Input.Password placeholder="secret-token" />
        </Form.Item>
      </div>

      <UpstreamRequestSection name="precheck" title="预检测" tone="green">
        <UpstreamExpectationFields name="precheck" />
      </UpstreamRequestSection>

      <UpstreamRequestSection name="stock" title="库存查询" tone="amber">
        <UpstreamExpectationFields name="stock" />
        <div className="upstream-fields-title">库存判断</div>
        <div className="form-grid">
          <Form.Item name={["upstreamConfig", "stock", "stockPath"]} label="库存字段">
            <Input placeholder="data.stock" />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "stock", "minStock"]} label="最小库存">
            <InputNumber min={0} precision={0} className="full-width" />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "stock", "availablePath"]} label="可用字段">
            <Input placeholder="data.available" />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "stock", "availableEqualsType"]} label="可用值类型">
            <Select options={SCALAR_VALUE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "stock", "availableEquals"]} label="可用等于">
            <Input placeholder="true / 1 / available" />
          </Form.Item>
        </div>
      </UpstreamRequestSection>

      <UpstreamRequestSection name="order" title="上游下单" tone="blue">
        <UpstreamExpectationFields name="order" />
        <div className="upstream-fields-title">发货提取</div>
        <div className="form-grid">
          <Form.Item name={["upstreamConfig", "order", "successPath"]} label="成功字段">
            <Input placeholder="code" />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "order", "successEqualsType"]} label="成功值类型">
            <Select options={SCALAR_VALUE_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "order", "successEquals"]} label="成功等于">
            <Input placeholder="200" />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "order", "deliveryPath"]} label="发货字段">
            <Input placeholder="data.secret" />
          </Form.Item>
          <Form.Item name={["upstreamConfig", "order", "remoteOrderIdPath"]} label="上游订单号字段">
            <Input placeholder="data.orderId" />
          </Form.Item>
        </div>
      </UpstreamRequestSection>
    </section>
  );
}

function UpstreamRequestSection({
  name,
  title,
  tone,
  children
}: {
  name: UpstreamRequestKey;
  title: string;
  tone: "green" | "amber" | "blue";
  children: ReactNode;
}) {
  return (
    <div className={`upstream-section upstream-section-${tone}`}>
      <div className="upstream-section-header">
        <div className="upstream-section-title">
          <span>{title}</span>
          <em>{name}</em>
        </div>
        <Form.Item name={["upstreamConfig", name, "enabled"]} valuePropName="checked" noStyle>
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </div>
      <div className="form-grid">
        <Form.Item name={["upstreamConfig", name, "method"]} label="Method">
          <Select options={HTTP_METHOD_OPTIONS} />
        </Form.Item>
        <Form.Item name={["upstreamConfig", name, "timeoutMs"]} label="超时">
          <InputNumber min={1000} step={500} precision={0} className="full-width" suffix="ms" />
        </Form.Item>
      </div>
      <Form.Item name={["upstreamConfig", name, "url"]} label="URL">
        <Input placeholder="https://upstream.example/api" />
      </Form.Item>
      <Form.Item name={["upstreamConfig", name, "headersText"]} label="请求头">
        <TextArea rows={3} spellCheck={false} placeholder={"authorization: Bearer {{token}}\ncontent-type: application/json"} />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, current) => prev.upstreamConfig?.[name]?.method !== current.upstreamConfig?.[name]?.method}>
        {({ getFieldValue }) => {
          const method = getFieldValue(["upstreamConfig", name, "method"]);
          return method === "GET" ? null : (
            <>
              <div className="form-grid">
                <Form.Item name={["upstreamConfig", name, "bodyType"]} label="Body 类型">
                  <Select options={BODY_TYPE_OPTIONS} />
                </Form.Item>
              </div>
              <Form.Item name={["upstreamConfig", name, "bodyText"]} label="请求体">
                <TextArea rows={5} spellCheck={false} placeholder={'{"sku":"{{sku}}","orderId":"{{orderId}}"}'} />
              </Form.Item>
            </>
          );
        }}
      </Form.Item>
      {children}
    </div>
  );
}

function UpstreamExpectationFields({ name }: { name: UpstreamRequestKey }) {
  return (
    <>
      <div className="upstream-fields-title">Expect 判断</div>
      <Form.Item noStyle shouldUpdate={(prev, current) => prev.upstreamConfig?.[name]?.expectMode !== current.upstreamConfig?.[name]?.expectMode}>
        {({ getFieldValue }) => {
          const mode = (getFieldValue(["upstreamConfig", name, "expectMode"]) ?? "truthy") as ExpectMode;
          return (
            <div className="upstream-expect-grid">
              <Form.Item name={["upstreamConfig", name, "expectMode"]} label="判断方式">
                <Select options={EXPECT_MODE_OPTIONS} />
              </Form.Item>
              <Form.Item name={["upstreamConfig", name, "expectPath"]} label="返回字段">
                <Input placeholder="ok" />
              </Form.Item>
              {mode === "equals" && (
                <>
                  <Form.Item name={["upstreamConfig", name, "expectEqualsType"]} label="值类型">
                    <Select options={SCALAR_VALUE_TYPE_OPTIONS} />
                  </Form.Item>
                  <Form.Item name={["upstreamConfig", name, "expectEquals"]} label="等于">
                    <Input placeholder="30.00" />
                  </Form.Item>
                </>
              )}
            </div>
          );
        }}
      </Form.Item>
    </>
  );
}

function CardsDrawer({ product, open, onClose, onSaved }: { product: Product | null; open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { message } = AntApp.useApp();
  const [cards, setCards] = useState("");
  const [recentCards, setRecentCards] = useState<Array<{ id: number; secretPreview: string; status: string }>>([]);

  useEffect(() => {
    if (!product) {
      return;
    }
    listProductCards(product.id).then(setRecentCards).catch(() => setRecentCards([]));
  }, [product]);

  return (
    <Drawer title={product ? `${product.title} 卡密库存` : "卡密库存"} open={open} onClose={onClose} size={560} destroyOnHidden>
      <TextArea rows={10} value={cards} onChange={(event) => setCards(event.target.value)} placeholder="每行一条卡密" />
      <Button
        type="primary"
        className="drawer-action"
        onClick={async () => {
          if (!product) {
            return;
          }
          try {
            await addProductCards(product.id, { cards });
            message.success("卡密已入库");
            setCards("");
            await onSaved();
            setRecentCards(await listProductCards(product.id));
          } catch (error) {
            message.error(error instanceof Error ? error.message : "入库失败");
          }
        }}
      >
        保存卡密
      </Button>
      <div className="mini-list">
        {recentCards.map((card) => (
          <div key={card.id} className="mini-row">
            <Text>{card.secretPreview}</Text>
            <StatusTag value={card.status} text={card.status === "available" ? "可用" : "已发货"} />
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function Storefront() {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<StoreSettings>({
    feishuWebhookUrl: null,
    storeName: "PeerPay Store",
    storeNotice: "",
    ads: [],
    peerpayBaseUrl: null,
    storeBaseUrl: null,
    peerpayPaymentChannel: "alipay",
    peerpayTtlMinutes: 15
  });
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [activeAdIndex, setActiveAdIndex] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadPublicStore();
      setSettings(data.settings);
      setProducts(data.products);
      setRecentOrders(await loadRememberedOrders());
    } catch (error) {
      message.error(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const ads = settings.ads ?? [];
    if (ads.length <= 1) {
      setActiveAdIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setActiveAdIndex((index) => (index + 1) % ads.length);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [settings.ads]);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/orders\/([^/]+)$/);
    if (!match) {
      return;
    }
    loadPublicOrder(decodeURIComponent(match[1]))
      .then((loaded) => {
        if (loaded) {
          setOrder(loaded);
        }
      })
      .catch((error) => message.error(error instanceof Error ? error.message : "订单加载失败"));
  }, [message]);

  return (
    <main className="store-page">
      <section className="store-shell">
        <header className="store-masthead">
          <div>
            <p className="store-eyebrow">OPEN SOURCE STORE</p>
            <h1>{settings.storeName}</h1>
            <Text>{settings.storeNotice || "固定价格、自动发货和自助查询。无需登录即可下单。"}</Text>
          </div>
          <div className="store-status-chip">
            <span>当前商品</span>
            <strong>{loading ? "-" : products.length}</strong>
          </div>
        </header>

        <AdRotator ads={settings.ads ?? []} activeIndex={activeAdIndex} onSelect={setActiveAdIndex} />

        <section className="store-workspace">
          <div className="store-panel product-board">
            <div className="store-panel-header">
              <h2>商品</h2>
              <Button className="store-button store-button-compact" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>刷新</Button>
            </div>
            <div className="product-grid">
              {products.map((product) => (
                <button
                  className="product-card"
                  key={product.id}
                  onClick={async () => {
                    const fresh = await loadPublicProduct(product.slug);
                    setSelected(fresh ?? product);
                  }}
                >
                  <span className="product-card-media">
                    <ProductVisual product={product} card />
                    <span className="product-card-stock">
                      {product.available ? "可购买" : "无库存"}
                    </span>
                  </span>
                  <span className="product-card-body">
                    <span className="product-card-title">{product.title}</span>
                    {product.description && <span className="product-card-desc">{product.description}</span>}
                    <span className="product-card-footer">
                      <span className="product-card-meta">¥{product.price}</span>
                      <span className="product-card-tags">
                        <StatusTag value={product.available ? "active" : "archived"} text={product.available ? "有货" : "无库存"} />
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="store-panel lookup-panel">
            <div className="store-panel-header">
              <h2>订单</h2>
              <span className="panel-mark">#</span>
            </div>
            <div className="lookup-body">
              <OrderSearch
                searching={searching}
                onSearch={async (contact) => {
                  setSearching(true);
                  try {
                    setRecentOrders(await searchOrders(contact));
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : "查询失败");
                  } finally {
                    setSearching(false);
                  }
                }}
              />
              <RecentOrders orders={recentOrders} onOpen={setOrder} />
            </div>
          </div>
        </section>
      </section>

      <ProductModal
        product={selected}
        defaultPaymentChannel={settings.peerpayPaymentChannel}
        onClose={() => setSelected(null)}
        onOrdered={(created) => {
          setSelected(null);
          setOrder(created);
          setRecentOrders((items) => [created, ...items.filter((item) => item.id !== created.id)]);
        }}
      />
      <OrderModal order={order} onClose={() => setOrder(null)} />
    </main>
  );
}

function AdRotator({ ads, activeIndex, onSelect }: { ads: StoreAd[]; activeIndex: number; onSelect: (index: number) => void }) {
  const activeAds = ads.filter((ad) => ad.title);
  if (!activeAds.length) {
    return null;
  }
  const active = activeAds[activeIndex % activeAds.length] ?? activeAds[0];
  const style = adGradientStyle(active.gradientColor);
  const content = (
    <div className="store-ad-copy">
      <span className="store-ad-kicker">精选</span>
      <strong>{active.title}</strong>
      {active.body && <p>{active.body}</p>}
      {active.linkText && <em>{active.linkText}</em>}
    </div>
  );

  return (
    <section className={active.imageUrl ? "store-ad-slot store-ad-slot-with-image" : "store-ad-slot"} style={style}>
      {active.linkUrl ? (
        <a className="store-ad-link" href={active.linkUrl} target="_blank" rel="noreferrer">{content}</a>
      ) : (
        <div className="store-ad-link">{content}</div>
      )}
      {active.imageUrl && <div className="store-ad-image" style={{ backgroundImage: `url(${active.imageUrl})` }} />}
      {activeAds.length > 1 && (
        <div className="store-ad-dots">
          {activeAds.map((ad, index) => (
            <button
              key={`${ad.title}-${index}`}
              className={index === activeIndex % activeAds.length ? "store-ad-dot active" : "store-ad-dot"}
              onClick={() => onSelect(index)}
              aria-label={`切换到广告 ${index + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProductModal({
  product,
  defaultPaymentChannel,
  onClose,
  onOrdered
}: {
  product: PublicProduct | null;
  defaultPaymentChannel: PaymentChannel;
  onClose: () => void;
  onOrdered: (order: Order) => void;
}) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (product) {
      form.setFieldValue("paymentChannel", defaultPaymentChannel);
    }
  }, [defaultPaymentChannel, form, product]);

  return (
    <StoreDialog open={Boolean(product)} onClose={onClose} labelledBy="product-dialog-title">
      {product && (
        <div className="store-dialog-card">
          <div className="store-dialog-media">
            <ProductVisual product={product} large />
          </div>
          <section className="store-dialog-copy">
            <Text className="store-eyebrow">商品详情</Text>
            <Title id="product-dialog-title" level={2}>{product.title}</Title>
            <Paragraph>{product.description || "该商品支持自助下单、付款后自动发货和历史订单查询。"}</Paragraph>
            <div className="price-line">¥{product.price}</div>
            <div className="tag-row">
              <StatusTag value={product.available ? "active" : "archived"} text={product.available ? "有货" : "无库存"} />
              <Tag>{PICKUP_OPEN_MODE_LABELS[product.pickupOpenMode]}</Tag>
            </div>
            <Form
              form={form}
              layout="vertical"
              disabled={!product.available}
              onFinish={async (values) => {
                setLoading(true);
                try {
                  const result = await createPublicOrder({
                    slug: product.slug,
                    contactValue: values.contactValue,
                    paymentChannel: values.paymentChannel,
                    remark: values.remark
                  });
                  await rememberOrder(result.order.id);
                  if (result.paymentUrl) {
                    window.location.assign(result.paymentUrl);
                    return;
                  }
                  onOrdered(result.order);
                } catch (error) {
                  message.error(storefrontErrorMessage(error));
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Form.Item name="contactValue" label="联系方式" extra="可填写 QQ、手机号码或者邮箱，用于查询历史订单。" rules={[{ required: true }]}>
                <Input size="large" placeholder="QQ / 手机号码 / 邮箱" />
              </Form.Item>
              <Form.Item name="paymentChannel" label="支付方式" rules={[{ required: true, message: "请选择支付方式" }]}>
                <Radio.Group className="payment-channel-picker">
                  <Radio.Button value="alipay">
                    <AlipayCircleOutlined />
                    <span>{PAYMENT_CHANNEL_LABELS.alipay}</span>
                  </Radio.Button>
                  <Radio.Button value="wechat">
                    <WechatOutlined />
                    <span>{PAYMENT_CHANNEL_LABELS.wechat}</span>
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
              <Form.Item name="remark" label="备注" extra="可填写发货偏好、人工处理说明或其他需要核对的信息。" rules={[{ max: 500, message: "备注不能超过 500 字" }]}>
                <TextArea rows={3} maxLength={500} showCount placeholder="选填，最多 500 字" />
              </Form.Item>
              <Button className="store-button store-button-primary store-button-full" htmlType="submit" loading={loading} block disabled={!product.available} icon={<ShoppingCartOutlined />}>
                {product.available ? "提交订单并付款" : "无库存"}
              </Button>
            </Form>
          </section>
        </div>
      )}
    </StoreDialog>
  );
}

function OrderModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  return (
    <StoreDialog open={Boolean(order)} onClose={onClose} labelledBy="order-dialog-title">
      {order && (
        <div className="store-dialog-card store-dialog-card-wide">
          <section className="store-dialog-copy store-dialog-copy-wide">
            <Text className="store-eyebrow">订单详情</Text>
            <Title id="order-dialog-title" level={2}>{order.id}</Title>
            <OrderDetails order={order} publicView />
          </section>
        </div>
      )}
    </StoreDialog>
  );
}

function StoreDialog({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="store-dialog-layer" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button className="store-dialog-backdrop" onClick={onClose} aria-label="关闭弹窗" />
      <div className="store-dialog-frame">
        <button className="store-dialog-close" onClick={onClose} aria-label="关闭弹窗">×</button>
        {children}
      </div>
    </div>
  );
}

function OrderDetails({ order, publicView = false }: { order: Order; publicView?: boolean }) {
  return (
    <div className={publicView ? "order-detail public-order-detail" : "order-detail"}>
      <div className="settings-grid">
        <InfoCell label="商品" value={order.productTitle} />
        <InfoCell label="金额" value={`¥${order.amount}`} />
        <InfoCell label="联系方式" value={order.contactValue} />
        <InfoCell label="支付方式" value={paymentChannelText(order.peerpayPaymentChannel)} />
        <InfoCell label="状态" value={ORDER_STATUS_LABELS[order.status]} />
        <InfoCell label="下单时间" value={formatDate(order.createdAt)} />
      </div>
      {order.status === "pending_payment" && order.peerpayPayUrl && (
        <section className="payment-box">
          <CheckCircleOutlined />
          <div>
            <strong>订单已创建，等待付款</strong>
            <span>PeerPay 应付金额：¥{order.peerpayActualAmount ?? order.amount}</span>
            <span>支付方式：{paymentChannelText(order.peerpayPaymentChannel)}</span>
          </div>
          <Button className={publicView ? "store-button store-button-primary" : undefined} type={publicView ? undefined : "primary"} href={order.peerpayPayUrl}>继续付款</Button>
        </section>
      )}
      {order.remark && (
        <section className="remark-box">
          <MessageOutlined />
          <span>{order.remark}</span>
        </section>
      )}
      {order.deliveryPayload && (
        <section className="delivery-box">
          <Text type="secondary">发货内容</Text>
          <pre>{order.deliveryPayload}</pre>
        </section>
      )}
      {order.manualReason && (
        <section className="manual-box">
          <BellOutlined />
          <span>{publicView ? "订单处理中，请联系商家处理" : order.manualReason}</span>
        </section>
      )}
      {order.pickupUrl && order.pickupOpenMode === "new_tab" && (
        <Button className={publicView ? "store-button store-button-primary" : undefined} type={publicView ? undefined : "primary"} href={order.pickupUrl} target="_blank">打开提货网站</Button>
      )}
      {order.pickupUrl && order.pickupOpenMode === "iframe" && (
        <iframe className="pickup-frame" src={order.pickupUrl} title="自助提货" />
      )}
    </div>
  );
}

function OrderSearch({ searching, onSearch }: { searching: boolean; onSearch: (contact: string) => Promise<void> }) {
  return (
    <Form layout="vertical" onFinish={(values) => onSearch(values.contact)}>
      <Form.Item name="contact" label="联系方式">
        <Input placeholder="QQ / 手机号码 / 邮箱" />
      </Form.Item>
      <Button className="store-button store-button-full" htmlType="submit" icon={<SearchOutlined />} loading={searching}>查询历史订单</Button>
    </Form>
  );
}

function RecentOrders({ orders, onOpen }: { orders: Order[]; onOpen: (order: Order) => void }) {
  if (!orders.length) {
    return <div className="empty-orders">暂无本机或联系方式关联订单</div>;
  }
  return (
    <div className="recent-orders">
      {orders.map((order) => (
        <button key={order.id} className="recent-order" onClick={() => onOpen(order)}>
          <span>{order.productTitle}</span>
          <strong>{ORDER_STATUS_LABELS[order.status]}</strong>
          <small>{order.id}</small>
        </button>
      ))}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand auth-brand" : "brand"}>
      <span className="brand-mark"><ShopOutlined /></span>
      <span className="brand-title">PeerPay Store</span>
    </div>
  );
}

function ProductTitle({ product }: { product: Product }) {
  return (
    <div className="product-title-cell">
      <ProductVisual product={product} />
      <div>
        <strong>{product.title}</strong>
        <br />
        <Text type="secondary">/{product.slug}</Text>
      </div>
    </div>
  );
}

function ProductVisual({ product, large = false, card = false }: { product: Product | PublicProduct; large?: boolean; card?: boolean }) {
  const style = product.coverUrl ? { backgroundImage: `url(${product.coverUrl})` } : undefined;
  const className = card ? "product-visual product-visual-card" : large ? "product-visual product-visual-large" : "product-visual";
  return (
    <span className={className} style={style}>
      {!product.coverUrl && <ShopOutlined />}
    </span>
  );
}

function ImageUrlUploadField({
  id,
  value,
  onChange,
  placeholder = "上传图片后自动填入，也可以粘贴图片 URL",
  uploadText = "上传图片"
}: {
  id?: string;
  value?: string | null;
  onChange?: (value: string) => void;
  placeholder?: string;
  uploadText?: string;
}) {
  const { message } = AntApp.useApp();
  const [uploading, setUploading] = useState(false);
  const imageUrl = typeof value === "string" ? value.trim() : "";

  return (
    <div className="image-url-field">
      <div className="image-url-row">
        <Input
          id={id}
          prefix={<PictureOutlined />}
          value={value ?? ""}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          allowClear
        />
        <Upload
          accept={IMAGE_UPLOAD_ACCEPT}
          customRequest={async (options) => {
            setUploading(true);
            try {
              const result = await uploadImage(options.file as File);
              onChange?.(result.url);
              options.onSuccess?.(result);
              message.success("图片已上传");
            } catch (error) {
              const uploadError = error instanceof Error ? error : new Error("上传失败");
              options.onError?.(uploadError);
              message.error(uploadError.message);
            } finally {
              setUploading(false);
            }
          }}
          maxCount={1}
          showUploadList={false}
        >
          <Button icon={<UploadOutlined />} loading={uploading}>{uploadText}</Button>
        </Upload>
      </div>
      {imageUrl && (
        <div className="image-url-preview" role="img" aria-label="图片预览" style={{ backgroundImage: `url(${imageUrl})` }} />
      )}
    </div>
  );
}

function StatusTag({ value, text }: { value: string; text: string }) {
  return <Tag color={statusColor[value] ?? "default"}>{text}</Tag>;
}

function renderPaymentChannel(value: PaymentChannel | null) {
  return value ? <Tag>{PAYMENT_CHANNEL_LABELS[value]}</Tag> : <Text type="secondary">-</Text>;
}

function paymentChannelText(value: PaymentChannel | null) {
  return value ? PAYMENT_CHANNEL_LABELS[value] : "-";
}

function storefrontErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "下单失败";
  return /上游|预检测|动态|库存|无货|暂无库存|未配置/.test(message) ? "无库存" : message;
}

function InfoCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="setting-cell">
      <Text type="secondary">{label}</Text>
      <strong>{value}</strong>
    </div>
  );
}

function upstreamConfigToForm(config: UpstreamConfig): UpstreamConfigFormValue {
  return {
    sku: config.sku ?? "",
    token: config.token ?? "",
    precheck: upstreamRequestToForm(config.precheck),
    stock: upstreamRequestToForm(config.stock),
    order: upstreamRequestToForm(config.order)
  };
}

function upstreamRequestToForm(request?: UpstreamHttpRequest): UpstreamRequestFormValue {
  const bodyType = request?.bodyType ?? inferUpstreamBodyType(request);
  return {
    enabled: Boolean(request?.enabled),
    method: request?.method ?? "GET",
    url: request?.url ?? "",
    timeoutMs: request?.timeoutMs ?? 5000,
    headersText: formatObjectText(request?.headers),
    bodyType,
    bodyText: formatBodyText(request?.body, bodyType),
    ...expectationToForm(request?.expect),
    stockPath: (request as UpstreamStockRequest | undefined)?.stockPath ?? "",
    minStock: (request as UpstreamStockRequest | undefined)?.minStock ?? 1,
    availablePath: (request as UpstreamStockRequest | undefined)?.availablePath ?? "",
    availableEquals: formatScalarText((request as UpstreamStockRequest | undefined)?.availableEquals),
    availableEqualsType: scalarValueType((request as UpstreamStockRequest | undefined)?.availableEquals),
    successPath: (request as UpstreamOrderRequest | undefined)?.successPath ?? "",
    successEquals: formatScalarText((request as UpstreamOrderRequest | undefined)?.successEquals),
    successEqualsType: scalarValueType((request as UpstreamOrderRequest | undefined)?.successEquals),
    deliveryPath: (request as UpstreamOrderRequest | undefined)?.deliveryPath ?? "",
    remoteOrderIdPath: (request as UpstreamOrderRequest | undefined)?.remoteOrderIdPath ?? ""
  };
}

function inferUpstreamBodyType(request?: UpstreamHttpRequest): HttpBodyType {
  const contentType = Object.entries(request?.headers ?? {})
    .find(([key]) => key.toLowerCase() === "content-type")?.[1]
    ?.toLowerCase() ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return "form";
  }
  return typeof request?.body === "string" ? "raw" : "json";
}

function expectationToForm(expectation?: HttpExpectation): Pick<UpstreamRequestFormValue, "expectMode" | "expectPath" | "expectEquals" | "expectEqualsType"> {
  if (!expectation) {
    return { expectMode: "truthy", expectPath: "", expectEquals: "", expectEqualsType: "string" };
  }
  if ("equals" in expectation) {
    return {
      expectMode: "equals",
      expectPath: expectation.path ?? "",
      expectEquals: formatScalarText(expectation.equals),
      expectEqualsType: scalarValueType(expectation.equals)
    };
  }
  if (expectation.exists === false) {
    return { expectMode: "missing", expectPath: expectation.path ?? "", expectEquals: "", expectEqualsType: "string" };
  }
  if (expectation.exists === true) {
    return { expectMode: "exists", expectPath: expectation.path ?? "", expectEquals: "", expectEqualsType: "string" };
  }
  return { expectMode: "truthy", expectPath: expectation.path ?? "", expectEquals: "", expectEqualsType: "string" };
}

function normalizeUpstreamConfigForm(value: unknown): UpstreamConfig {
  const input = value && typeof value === "object" ? value as UpstreamConfigFormValue : {};
  return stripEmptyObject({
    sku: trimToUndefined(input.sku),
    token: trimToUndefined(input.token),
    precheck: normalizeUpstreamRequestForm(input.precheck),
    stock: normalizeUpstreamStockRequestForm(input.stock),
    order: normalizeUpstreamOrderRequestForm(input.order)
  }) as UpstreamConfig;
}

function normalizeUpstreamRequestForm(value: UpstreamRequestFormValue | undefined): UpstreamHttpRequest {
  const method = normalizeHttpMethod(value?.method);
  const headers = parseLooseObject(value?.headersText, "请求头");
  const bodyType = normalizeBodyType(value?.bodyType);
  const body = method === "GET" ? undefined : parseRequestBody(value?.bodyText, bodyType);
  return stripEmptyObject({
    enabled: Boolean(value?.enabled),
    method,
    url: trimToUndefined(value?.url),
    timeoutMs: normalizeOptionalNumber(value?.timeoutMs),
    headers,
    bodyType: body === undefined ? undefined : bodyType,
    body,
    expect: normalizeExpectationForm(value)
  }) as UpstreamHttpRequest;
}

function normalizeUpstreamStockRequestForm(value: UpstreamRequestFormValue | undefined): UpstreamStockRequest {
  return stripEmptyObject({
    ...normalizeUpstreamRequestForm(value),
    stockPath: trimToUndefined(value?.stockPath),
    minStock: normalizeOptionalNumber(value?.minStock),
    availablePath: trimToUndefined(value?.availablePath),
    availableEquals: parseOptionalScalar(value?.availableEquals, value?.availableEqualsType)
  }) as UpstreamStockRequest;
}

function normalizeUpstreamOrderRequestForm(value: UpstreamRequestFormValue | undefined): UpstreamOrderRequest {
  return stripEmptyObject({
    ...normalizeUpstreamRequestForm(value),
    successPath: trimToUndefined(value?.successPath),
    successEquals: parseOptionalScalar(value?.successEquals, value?.successEqualsType),
    deliveryPath: trimToUndefined(value?.deliveryPath),
    remoteOrderIdPath: trimToUndefined(value?.remoteOrderIdPath)
  }) as UpstreamOrderRequest;
}

function normalizeExpectationForm(value: UpstreamRequestFormValue | undefined): HttpExpectation | undefined {
  const mode = value?.expectMode ?? "truthy";
  const path = trimToUndefined(value?.expectPath);
  if (mode === "equals") {
    return stripEmptyObject({ path, equals: parseScalar(value?.expectEquals ?? "", value?.expectEqualsType) }) as HttpExpectation;
  }
  if (mode === "exists") {
    return stripEmptyObject({ path, exists: true }) as HttpExpectation;
  }
  if (mode === "missing") {
    return stripEmptyObject({ path, exists: false }) as HttpExpectation;
  }
  return path ? { path } : undefined;
}

function normalizeHttpMethod(value: unknown): UpstreamHttpRequest["method"] {
  return value === "POST" || value === "PUT" || value === "PATCH" ? value : "GET";
}

function normalizeBodyType(value: unknown): HttpBodyType {
  return value === "form" || value === "raw" ? value : "json";
}

function parseRequestBody(value: unknown, bodyType: HttpBodyType) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return undefined;
  }
  if (bodyType === "raw") {
    return String(value ?? "");
  }
  if (bodyType === "form") {
    if (!text.startsWith("{") && text.includes("&")) {
      return parseFormQueryText(text);
    }
    return parseLooseObject(text, "请求体");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("请求体必须是有效 JSON");
  }
}

function parseFormQueryText(text: string) {
  const params = new URLSearchParams(text);
  const body: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    const current = body[key];
    if (current === undefined) {
      body[key] = value;
      return;
    }
    body[key] = Array.isArray(current) ? [...current, value] : [current, value];
  });
  return body;
}

function parseLooseObject(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return undefined;
  }
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      throw new Error(`${label} JSON 格式不正确`);
    }
    throw new Error(`${label} 必须是对象`);
  }
  const entries = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndexes = [line.indexOf(":"), line.indexOf("=")].filter((index) => index > 0);
      if (!separatorIndexes.length) {
        throw new Error(`${label} 行格式不正确`);
      }
      const separatorIndex = Math.min(...separatorIndexes);
      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()] as const;
    })
    .filter(([key]) => key);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseOptionalScalar(value: unknown, type: ScalarValueType | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? parseScalar(text, type) : undefined;
}

function parseScalar(value: unknown, type: ScalarValueType | undefined) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "");
  if (!text) {
    return "";
  }
  const valueType = type ?? "string";
  if (valueType === "string") {
    return text;
  }
  if (valueType === "number") {
    const number = Number(text);
    if (!Number.isFinite(number)) {
      throw new Error("等于值必须是有效数字");
    }
    return number;
  }
  if (valueType === "boolean") {
    if (text === "true" || text === "1") {
      return true;
    }
    if (text === "false" || text === "0") {
      return false;
    }
    throw new Error("等于值必须是 true、false、1 或 0");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("等于值必须是有效 JSON");
  }
}

function normalizeOptionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function trimToUndefined(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function stripEmptyObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === null || item === "") {
      return false;
    }
    if (typeof item === "object" && !Array.isArray(item) && !Object.keys(item).length) {
      return false;
    }
    return true;
  }));
}

function formatObjectText(value: Record<string, string> | undefined) {
  if (!value || !Object.keys(value).length) {
    return "";
  }
  return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join("\n");
}

function formatBodyText(value: unknown, bodyType: HttpBodyType) {
  if (value === undefined || value === null) {
    return "";
  }
  if (bodyType === "raw" && typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function formatScalarText(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function scalarValueType(value: unknown): ScalarValueType {
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "string" || value === undefined || value === null) {
    return "string";
  }
  return "json";
}

function normalizeProductForm(values: Record<string, unknown>) {
  const deliveryMode = values.deliveryMode as DeliveryMode;
  const upstreamConfig = deliveryMode === "upstream" ? normalizeUpstreamConfigForm(values.upstreamConfig) : null;
  return {
    slug: values.slug ? String(values.slug) : undefined,
    title: String(values.title ?? ""),
    description: String(values.description ?? ""),
    price: Number(values.price),
    status: values.status as ProductStatus,
    coverUrl: String(values.coverUrl ?? "").trim() || null,
    sortOrder: Number(values.sortOrder ?? 100),
    deliveryMode,
    pickupUrl: values.pickupUrl ? String(values.pickupUrl) : null,
    pickupOpenMode: values.pickupOpenMode as PickupOpenMode,
    upstreamConfig
  };
}

function normalizeStoreSettingsForm(values: Record<string, unknown>) {
  const peerpayPaymentChannel: PaymentChannel = values.peerpayPaymentChannel === "wechat" ? "wechat" : "alipay";
  return {
    storeName: String(values.storeName ?? ""),
    storeNotice: String(values.storeNotice ?? ""),
    peerpayBaseUrl: values.peerpayBaseUrl ? String(values.peerpayBaseUrl) : null,
    storeBaseUrl: values.storeBaseUrl ? String(values.storeBaseUrl) : null,
    peerpayPaymentChannel,
    peerpayTtlMinutes: Number(values.peerpayTtlMinutes ?? 15)
  };
}

function normalizeNotificationSettingsForm(values: Record<string, unknown>) {
  return {
    feishuWebhookUrl: values.feishuWebhookUrl ? String(values.feishuWebhookUrl) : null
  };
}

function normalizeAdsForm(values: unknown) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((item) => item as Partial<StoreAd>)
    .map((item) => ({
      title: String(item.title ?? "").trim(),
      body: String(item.body ?? "").trim() || undefined,
      gradientColor: normalizeHexColor(String(item.gradientColor ?? "")),
      imageUrl: String(item.imageUrl ?? "").trim() || null,
      linkUrl: String(item.linkUrl ?? "").trim() || null,
      linkText: String(item.linkText ?? "").trim() || undefined
    }))
    .filter((item) => item.title);
}

function emptyAd(): StoreAd {
  return { title: "", body: "", gradientColor: "#f0c84b", imageUrl: null, linkUrl: "", linkText: "查看详情" };
}

function normalizeHexColor(value: string) {
  const text = value.trim();
  return HEX_COLOR_PATTERN.test(text) ? text : null;
}

function adGradientStyle(value: string | null | undefined): AdGradientStyle {
  return {
    "--ad-gradient-start": AD_GRADIENT_START_COLOR,
    "--ad-gradient-color": normalizeHexColor(value ?? "") ?? DEFAULT_AD_GRADIENT_COLOR
  };
}

function statusOptions<T extends string>(record: Record<T, string>) {
  return Object.entries(record).map(([value, label]) => ({ value, label }));
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

async function rememberOrder(id: string) {
  const db = await openOrderDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("orders", "readwrite");
    tx.objectStore("orders").put({ id, createdAt: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadRememberedOrders() {
  const db = await openOrderDb();
  const ids = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction("orders", "readonly");
    const request = tx.objectStore("orders").getAll();
    request.onsuccess = () => resolve((request.result as Array<{ id: string; createdAt: string }>).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => item.id));
    request.onerror = () => reject(request.error);
  });
  db.close();
  const orders = await Promise.all(ids.slice(0, 20).map((id) => loadPublicOrder(id).catch(() => null)));
  return orders.filter((order): order is Order => Boolean(order));
}

function openOrderDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("peerpay-store", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("orders")) {
        db.createObjectStore("orders", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export default App;
