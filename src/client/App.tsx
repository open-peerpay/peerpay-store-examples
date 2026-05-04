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
  NotificationOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  UploadOutlined
} from "@ant-design/icons";
import {
  DEFAULT_UPSTREAM_CONFIG_EXAMPLE,
  DELIVERY_MODE_LABELS,
  ORDER_STATUS_LABELS,
  PICKUP_OPEN_MODE_LABELS,
  PRODUCT_STATUS_LABELS
} from "../shared/constants";
import type {
  AdminSessionState,
  DeliveryMode,
  Order,
  PaymentChannel,
  PickupOpenMode,
  Product,
  ProductStatus,
  PublicProduct,
  StoreAd,
  StoreSettings,
  SystemLog,
  UpstreamConfig
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
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
type AdGradientStyle = CSSProperties & {
  "--ad-gradient-start": string;
  "--ad-gradient-color": string;
};

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
  const columns: Columns<Order> = [
    { title: "订单号", dataIndex: "id", width: 190, render: (value) => <Text copyable>{value}</Text> },
    { title: "商品", dataIndex: "productTitle", render: (value, item) => <div><strong>{value}</strong><br /><Text type="secondary">¥{item.amount}</Text></div> },
    { title: "联系方式", dataIndex: "contactValue" },
    { title: "状态", dataIndex: "status", width: 120, render: (value) => <StatusTag value={value} text={ORDER_STATUS_LABELS[value as keyof typeof ORDER_STATUS_LABELS]} /> },
    { title: "时间", dataIndex: "createdAt", width: 180, render: formatDate },
    {
      title: "操作",
      width: 210,
      render: (_, item) => (
        <Space wrap>
          <Button size="small" disabled={item.status === "delivered"} onClick={async () => {
            try {
              await updateOrderStatus(item.id, "delivered", "后台标记已处理");
              await onChange();
            } catch (error) {
              message.error(error instanceof Error ? error.message : "更新失败");
            }
          }}>标记已处理</Button>
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
    <section className="panel">
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={orders}
        pagination={false}
        scroll={{ x: 1080 }}
        expandable={{ expandedRowRender: (order) => <OrderDetails order={order} /> }}
      />
    </section>
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
                      <Form.Item {...field} name={[field.name, "imageUrl"]} label="图片地址">
                        <Input prefix={<PictureOutlined />} placeholder="上传图片后自动填入，也可以粘贴图片 URL" />
                      </Form.Item>
                      <Form.Item {...field} name={[field.name, "linkUrl"]} label="点击跳转地址">
                        <Input prefix={<LinkOutlined />} placeholder="https://example.com 或 /orders" />
                      </Form.Item>
                    </div>
                    <Space wrap>
                      <Upload
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        customRequest={async (options) => {
                          try {
                            const result = await uploadImage(options.file as File);
                            form.setFieldValue(["ads", field.name, "imageUrl"], result.url);
                            options.onSuccess?.(result);
                            message.success("图片已上传");
                          } catch (error) {
                            const uploadError = error instanceof Error ? error : new Error("上传失败");
                            options.onError?.(uploadError);
                            message.error(uploadError.message);
                          }
                        }}
                        maxCount={1}
                        showUploadList={false}
                      >
                        <Button icon={<UploadOutlined />}>上传图片</Button>
                      </Upload>
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
        upstreamConfigText: JSON.stringify(DEFAULT_UPSTREAM_CONFIG_EXAMPLE, null, 2)
      });
      return;
    }
    form.setFieldsValue({
      ...product,
      price: Number(product.price),
      upstreamConfigText: JSON.stringify(product.upstreamConfig ?? DEFAULT_UPSTREAM_CONFIG_EXAMPLE, null, 2)
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
        <Form.Item name="coverUrl" label="封面图 URL">
          <Input />
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
            <Form.Item name="upstreamConfigText" label="动态上游配置 JSON">
              <TextArea rows={15} spellCheck={false} />
            </Form.Item>
          ) : null}
        </Form.Item>
      </Form>
    </Drawer>
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
            <Text>{settings.storeNotice || "固定价格、自动发货、动态取货和自助查询。无需登录即可下单。"}</Text>
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
                  <ProductVisual product={product} />
                  <span className="product-card-title">{product.title}</span>
                  <span className="product-card-meta">¥{product.price}</span>
                  <StatusTag value={product.available ? "active" : "archived"} text={product.available ? "有货" : product.availabilityReason ?? "无货"} />
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

function ProductModal({ product, onClose, onOrdered }: { product: PublicProduct | null; onClose: () => void; onOrdered: (order: Order) => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

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
              <StatusTag value={product.deliveryMode} text={DELIVERY_MODE_LABELS[product.deliveryMode]} />
              <StatusTag value={product.available ? "active" : "archived"} text={product.available ? "有货" : product.availabilityReason ?? "无货"} />
              <Tag>{PICKUP_OPEN_MODE_LABELS[product.pickupOpenMode]}</Tag>
            </div>
            <Form
              form={form}
              layout="vertical"
              disabled={!product.available}
              onFinish={async (values) => {
                setLoading(true);
                try {
                  const result = await createPublicOrder({ slug: product.slug, contactValue: values.contactValue });
                  await rememberOrder(result.order.id);
                  if (result.paymentUrl) {
                    window.location.assign(result.paymentUrl);
                    return;
                  }
                  onOrdered(result.order);
                } catch (error) {
                  message.error(error instanceof Error ? error.message : "下单失败");
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Form.Item name="contactValue" label="联系方式" extra="可填写 QQ、手机号码或者邮箱，用于查询历史订单。" rules={[{ required: true }]}>
                <Input size="large" placeholder="QQ / 手机号码 / 邮箱" />
              </Form.Item>
              <Button className="store-button store-button-primary store-button-full" htmlType="submit" loading={loading} block disabled={!product.available} icon={<ShoppingCartOutlined />}>
                {product.available ? "提交订单并付款" : "暂时无货"}
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
        <InfoCell label="状态" value={ORDER_STATUS_LABELS[order.status]} />
        <InfoCell label="下单时间" value={formatDate(order.createdAt)} />
      </div>
      {order.status === "pending_payment" && order.peerpayPayUrl && (
        <section className="payment-box">
          <CheckCircleOutlined />
          <div>
            <strong>订单已创建，等待付款</strong>
            <span>PeerPay 应付金额：¥{order.peerpayActualAmount ?? order.amount}</span>
          </div>
          <Button className={publicView ? "store-button store-button-primary" : undefined} type={publicView ? undefined : "primary"} href={order.peerpayPayUrl}>继续付款</Button>
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
          <span>{order.manualReason}</span>
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

function ProductVisual({ product, large = false }: { product: Product | PublicProduct; large?: boolean }) {
  const style = product.coverUrl ? { backgroundImage: `url(${product.coverUrl})` } : undefined;
  return (
    <span className={large ? "product-visual product-visual-large" : "product-visual"} style={style}>
      {!product.coverUrl && <ShopOutlined />}
    </span>
  );
}

function StatusTag({ value, text }: { value: string; text: string }) {
  return <Tag color={statusColor[value] ?? "default"}>{text}</Tag>;
}

function InfoCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="setting-cell">
      <Text type="secondary">{label}</Text>
      <strong>{value}</strong>
    </div>
  );
}

function normalizeProductForm(values: Record<string, unknown>) {
  const deliveryMode = values.deliveryMode as DeliveryMode;
  const upstreamText = String(values.upstreamConfigText ?? "").trim();
  let upstreamConfig: UpstreamConfig | null = null;
  if (deliveryMode === "upstream" && upstreamText) {
    upstreamConfig = JSON.parse(upstreamText) as UpstreamConfig;
  }
  return {
    slug: values.slug ? String(values.slug) : undefined,
    title: String(values.title ?? ""),
    description: String(values.description ?? ""),
    price: Number(values.price),
    status: values.status as ProductStatus,
    coverUrl: values.coverUrl ? String(values.coverUrl) : null,
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
