import {
  boolean,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
  realname: text('realname'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

/** RBAC */
export const authRole = pgTable('auth_role', {
  roleId: serial('role_id').primaryKey(),
  name: text('name').notNull(),
  /** Stable machine key, e.g. dealer / ops */
  key: text('key').unique(),
  description: text('description'),
  isDel: boolean('is_del').notNull().default(false),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

export const authPermission = pgTable('auth_permission', {
  permissionId: serial('permission_id').primaryKey(),
  parentPermissionId: integer('parent_permission_id'),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  sort: integer('sort').notNull().default(0),
  hide: boolean('hide').notNull().default(false),
});

export const authUserRoles = pgTable(
  'auth_user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => authRole.roleId, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const authRolePermissions = pgTable(
  'auth_role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => authRole.roleId, { onDelete: 'cascade' }),
    permissionId: integer('permission_id')
      .notNull()
      .references(() => authPermission.permissionId, { onDelete: 'cascade' }),
    /** ro = read-only, rw = read-write */
    rw: text('rw').notNull().default('rw'),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

/** Site settings & FX */
export const siteSettings = pgTable('site_settings', {
  id: text('id').primaryKey(),
  defaultCountryCode: text('default_country_code').notNull().default('US'),
  defaultCurrencyCode: text('default_currency_code').notNull().default('USD'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const exchangeRateSettings = pgTable('exchange_rate_settings', {
  id: text('id').primaryKey(),
  baseCurrencyCode: text('base_currency_code').notNull().default('USD'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const exchangeRates = pgTable('exchange_rates', {
  currencyCode: text('currency_code').primaryKey(),
  rateToBase: numeric('rate_to_base', { precision: 18, scale: 8 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Finance */
export const financeWallet = pgTable('finance_wallet', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  walletCode: text('wallet_code').notNull(),
  /** Always USD; never follows site default currency */
  currencyCode: text('currency_code').notNull().default('USD'),
  balance: numeric('balance', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  lastTradeId: integer('last_trade_id'),
  lastTradeBalance: numeric('last_trade_balance', { precision: 12, scale: 2 }),
  lastTradeTime: timestamp('last_trade_time'),
  lastTradeAmount: numeric('last_trade_amount', { precision: 12, scale: 2 }),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

export const financeTradeLog = pgTable('finance_trade_log', {
  id: serial('id').primaryKey(),
  tradeNumber: text('trade_number').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  direction: text('direction').notNull(), // in | out
  currencyCode: text('currency_code').notNull().default('USD'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  amountBase: numeric('amount_base', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  balance: numeric('balance', { precision: 12, scale: 2 }).notNull(),
  type: integer('type').notNull().default(5), // RECHARGE=5
  source: integer('source').notNull().default(7), // OFFLINE=7
  status: integer('status').notNull().default(1),
  orderNumber: text('order_number'),
  info: text('info'),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

export const financeRecharge = pgTable('finance_recharge', {
  id: serial('id').primaryKey(),
  rechargeNumber: text('recharge_number').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  userName: text('user_name'),
  currencyCode: text('currency_code').notNull().default('USD'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  amountBase: numeric('amount_base', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  remark: text('remark'),
  verifyRemark: text('verify_remark'),
  isVerify: integer('is_verify').notNull().default(0), // 0/1/2
  createAdminId: text('create_admin_id')
    .notNull()
    .references(() => user.id),
  verifyAdminId: text('verify_admin_id').references(() => user.id),
  verifyTime: timestamp('verify_time'),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

export const financeDeduction = pgTable('finance_deduction', {
  id: serial('id').primaryKey(),
  deductionNumber: text('deduction_number').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  userName: text('user_name'),
  currencyCode: text('currency_code').notNull().default('USD'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  amountBase: numeric('amount_base', { precision: 12, scale: 2 })
    .notNull()
    .default('0.00'),
  remark: text('remark'),
  verifyRemark: text('verify_remark'),
  isVerify: integer('is_verify').notNull().default(0),
  /** Linked goods reservation order (optional) */
  orderId: integer('order_id'),
  orderNumber: text('order_number'),
  createAdminId: text('create_admin_id')
    .notNull()
    .references(() => user.id),
  verifyAdminId: text('verify_admin_id').references(() => user.id),
  verifyTime: timestamp('verify_time'),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

/** Goods reservation / fulfill orders */
export const goodsOrder = pgTable('goods_order', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  dealerUserId: text('dealer_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** reserving | pending_fulfill | partial_fulfill | fulfilled | completed */
  status: text('status').notNull().default('reserving'),
  /** Snapshot of site default currency at create time */
  currencyCode: text('currency_code').notNull().default('USD'),
  /** 0=价格未齐 1=全部单价已填 */
  priceStatus: integer('price_status').notNull().default(0),
  dealerRemark: text('dealer_remark'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  totalAmountBase: numeric('total_amount_base', { precision: 12, scale: 2 }),
  deductionId: integer('deduction_id'),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

export const goodsOrderItem = pgTable('goods_order_item', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => goodsOrder.id, { onDelete: 'cascade' }),
  amazonUrl: text('amazon_url').notNull(),
  reserveQty: integer('reserve_qty').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
  fulfillQty: integer('fulfill_qty').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  createTime: timestamp('create_time').notNull().defaultNow(),
  updateTime: timestamp('update_time').notNull().defaultNow(),
});

export const schema = {
  user,
  session,
  account,
  verification,
  authRole,
  authPermission,
  authUserRoles,
  authRolePermissions,
  siteSettings,
  exchangeRateSettings,
  exchangeRates,
  financeWallet,
  financeTradeLog,
  financeRecharge,
  financeDeduction,
  goodsOrder,
  goodsOrderItem,
};
