import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createDatabase(databaseUrl = Bun.env.DATABASE_URL ?? "./data/peerpay-store.sqlite") {
  if (databaseUrl !== ":memory:") {
    mkdirSync(dirname(databaseUrl), { recursive: true });
  }

  const db = new Database(databaseUrl);
  db.exec("PRAGMA foreign_keys = ON;");
  if (databaseUrl !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
      cover_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('card', 'upstream', 'manual')),
      pickup_url TEXT,
      pickup_open_mode TEXT NOT NULL CHECK (pickup_open_mode IN ('none', 'iframe', 'new_tab')),
      lookup_methods TEXT NOT NULL DEFAULT '["phone","qq","email"]',
      upstream_config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_public
      ON products(status, sort_order, id);

    CREATE TABLE IF NOT EXISTS product_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      secret TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'delivered')) DEFAULT 'available',
      order_id TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_product_cards_stock
      ON product_cards(product_id, status, id);

    CREATE TABLE IF NOT EXISTS upstream_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_upstream_channels_updated
      ON upstream_channels(updated_at DESC);

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_slug TEXT NOT NULL,
      product_title TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      contact_type TEXT NOT NULL DEFAULT 'contact',
      contact_value TEXT NOT NULL,
      remark TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'delivered', 'needs_manual', 'failed', 'cancelled')),
      peerpay_order_id TEXT,
      peerpay_pay_url TEXT,
      peerpay_actual_amount_cents INTEGER,
      peerpay_payment_channel TEXT,
      peerpay_callback_secret TEXT,
      delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('card', 'upstream', 'manual')),
      delivery_payload TEXT,
      pickup_url TEXT,
      pickup_open_mode TEXT NOT NULL CHECK (pickup_open_mode IN ('none', 'iframe', 'new_tab')),
      upstream_order_id TEXT,
      upstream_response TEXT,
      upstream_captcha TEXT,
      upstream_captcha_token TEXT,
      manual_reason TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      delivered_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_created_at
      ON orders(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_orders_contact
      ON orders(contact_type, contact_value, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_orders_contact_value
      ON orders(contact_value, created_at DESC);

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_system_logs_created
      ON system_logs(created_at DESC);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  rebuildOrdersTableIfNeeded(db);
  ensureColumn(db, "orders", "peerpay_order_id", "ALTER TABLE orders ADD COLUMN peerpay_order_id TEXT");
  ensureColumn(db, "orders", "peerpay_pay_url", "ALTER TABLE orders ADD COLUMN peerpay_pay_url TEXT");
  ensureColumn(db, "orders", "peerpay_actual_amount_cents", "ALTER TABLE orders ADD COLUMN peerpay_actual_amount_cents INTEGER");
  ensureColumn(db, "orders", "peerpay_payment_channel", "ALTER TABLE orders ADD COLUMN peerpay_payment_channel TEXT");
  ensureColumn(db, "orders", "peerpay_callback_secret", "ALTER TABLE orders ADD COLUMN peerpay_callback_secret TEXT");
  ensureColumn(db, "orders", "remark", "ALTER TABLE orders ADD COLUMN remark TEXT");
  ensureColumn(db, "orders", "upstream_captcha", "ALTER TABLE orders ADD COLUMN upstream_captcha TEXT");
  ensureColumn(db, "orders", "upstream_captcha_token", "ALTER TABLE orders ADD COLUMN upstream_captcha_token TEXT");
}

function rebuildOrdersTableIfNeeded(db: Database) {
  const row = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string } | null;
  if (!row || (row.sql.includes("'pending_payment'") && !row.sql.includes("contact_type TEXT NOT NULL CHECK"))) {
    return;
  }

  db.exec("ALTER TABLE orders RENAME TO orders_legacy_migration");
  db.exec(`
    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_slug TEXT NOT NULL,
      product_title TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      contact_type TEXT NOT NULL DEFAULT 'contact',
      contact_value TEXT NOT NULL,
      remark TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'delivered', 'needs_manual', 'failed', 'cancelled')),
      peerpay_order_id TEXT,
      peerpay_pay_url TEXT,
      peerpay_actual_amount_cents INTEGER,
      peerpay_payment_channel TEXT,
      peerpay_callback_secret TEXT,
      delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('card', 'upstream', 'manual')),
      delivery_payload TEXT,
      pickup_url TEXT,
      pickup_open_mode TEXT NOT NULL CHECK (pickup_open_mode IN ('none', 'iframe', 'new_tab')),
      upstream_order_id TEXT,
      upstream_response TEXT,
      manual_reason TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      delivered_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO orders (
      id, product_id, product_slug, product_title, amount_cents, contact_type, contact_value,
      status, delivery_mode, delivery_payload, pickup_url, pickup_open_mode, upstream_order_id,
      upstream_response, manual_reason, created_at, paid_at, delivered_at, updated_at
    )
    SELECT
      id, product_id, product_slug, product_title, amount_cents, contact_type, contact_value,
      status, delivery_mode, delivery_payload, pickup_url, pickup_open_mode, upstream_order_id,
      upstream_response, manual_reason, created_at, paid_at, delivered_at, updated_at
    FROM orders_legacy_migration;
    DROP TABLE orders_legacy_migration;
  `);
}

function ensureColumn(db: Database, table: string, column: string, sql: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(sql);
  }
}
