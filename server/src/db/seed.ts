import { config } from 'dotenv';
import { and, eq } from 'drizzle-orm';
import { createCredentialUser } from '../auth/create-user.js';
import { db } from './index.js';
import {
  authPermission,
  authRole,
  authRolePermissions,
  authUserRoles,
  exchangeRateSettings,
  exchangeRates,
  financeWallet,
  siteSettings,
  user,
} from './schema.js';
import {
  DEFAULT_EXCHANGE_RATES,
  EXCHANGE_RATE_SETTINGS_ROW_ID,
  SITE_SETTINGS_ROW_ID,
  WALLET_CURRENCY,
} from '../site/exchange-rate-config.js';

config({ path: '.env' });

const PERMISSIONS: {
  code: string;
  name: string;
  description?: string;
  sort: number;
  parentCode?: string;
}[] = [
  {
    code: 'auth',
    name: '后台权限',
    description: '用户与角色管理',
    sort: 100,
  },
  {
    code: 'user_config',
    name: '管理员',
    description: '用户管理',
    sort: 110,
    parentCode: 'auth',
  },
  {
    code: 'role_config',
    name: '角色',
    description: '角色与权限绑定',
    sort: 120,
    parentCode: 'auth',
  },
  {
    code: 'finance',
    name: '财务',
    description: '财务模块',
    sort: 200,
  },
  {
    code: 'wallet',
    name: '钱包',
    description: '钱包列表',
    sort: 210,
    parentCode: 'finance',
  },
  {
    code: 'trade_log',
    name: '账户变动',
    description: '账户变动流水',
    sort: 220,
    parentCode: 'finance',
  },
  {
    code: 'recharge',
    name: '充值审核',
    description: '人工充值与审核',
    sort: 230,
    parentCode: 'finance',
  },
  {
    code: 'deduction',
    name: '扣费审核',
    description: '扣费审核',
    sort: 240,
    parentCode: 'finance',
  },
  {
    code: 'site',
    name: '站点管理',
    description: '汇率与全局配置',
    sort: 300,
  },
  {
    code: 'exchange_rate',
    name: '汇率管理',
    description: '维护各币种相对基准币汇率',
    sort: 310,
    parentCode: 'site',
  },
  {
    code: 'site_config',
    name: '全局配置',
    description: '区域与默认货币',
    sort: 320,
    parentCode: 'site',
  },
  {
    code: 'goods',
    name: '商品管理',
    description: '预约与履约订单',
    sort: 400,
  },
  {
    code: 'goods_reserve_create',
    name: '创建预约',
    description: '上传 Amazon 下单 Excel',
    sort: 410,
    parentCode: 'goods',
  },
  {
    code: 'goods_reserve_order',
    name: '预约订单',
    description: '经销商预约订单',
    sort: 420,
    parentCode: 'goods',
  },
  {
    code: 'goods_fulfill_order',
    name: '履约订单',
    description: '运营履约代拍',
    sort: 430,
    parentCode: 'goods',
  },
  {
    code: 'goods_history_order',
    name: '历史订单',
    description: '已完成订单',
    sort: 440,
    parentCode: 'goods',
  },
];

async function upsertPermissions() {
  const codeToId = new Map<string, number>();

  for (const item of PERMISSIONS) {
    const existing = await db
      .select()
      .from(authPermission)
      .where(eq(authPermission.code, item.code))
      .limit(1);

    if (existing[0]) {
      await db
        .update(authPermission)
        .set({
          name: item.name,
          description: item.description ?? null,
          sort: item.sort,
          parentPermissionId: item.parentCode
            ? (codeToId.get(item.parentCode) ??
              existing[0].parentPermissionId)
            : null,
        })
        .where(eq(authPermission.permissionId, existing[0].permissionId));
      codeToId.set(item.code, existing[0].permissionId);
    } else {
      const parentPermissionId = item.parentCode
        ? (codeToId.get(item.parentCode) ?? null)
        : null;
      const [row] = await db
        .insert(authPermission)
        .values({
          code: item.code,
          name: item.name,
          description: item.description ?? null,
          sort: item.sort,
          parentPermissionId,
          hide: false,
        })
        .returning();
      codeToId.set(item.code, row.permissionId);
    }
  }

  for (const item of PERMISSIONS) {
    if (!item.parentCode) continue;
    const id = codeToId.get(item.code);
    const parentId = codeToId.get(item.parentCode);
    if (id && parentId) {
      await db
        .update(authPermission)
        .set({ parentPermissionId: parentId })
        .where(eq(authPermission.permissionId, id));
    }
  }

  console.log('Permissions upserted:', [...codeToId.keys()].join(', '));
  return codeToId;
}

async function ensureAdminUser() {
  const email = 'admin@local.dev';
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_SEED_PASSWORD is not set');
  }

  const existing = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (existing[0]) {
    await db
      .update(user)
      .set({
        name: 'admin',
        isSuperAdmin: true,
        updatedAt: new Date(),
      })
      .where(eq(user.id, existing[0].id));
    console.log('Admin user already exists; ensured isSuperAdmin=true');
    return existing[0].id;
  }

  const created = await createCredentialUser({
    email,
    password,
    name: 'admin',
  });

  await db
    .update(user)
    .set({
      isSuperAdmin: true,
      realname: '超级管理员',
      updatedAt: new Date(),
    })
    .where(eq(user.id, created.id));

  console.log(`Admin user created: ${email}`);
  return created.id;
}

async function upsertRole(name: string, description: string, key: string) {
  const [existing] = await db
    .select()
    .from(authRole)
    .where(and(eq(authRole.name, name), eq(authRole.isDel, false)))
    .limit(1);
  if (existing) {
    await db
      .update(authRole)
      .set({ description, key, updateTime: new Date() })
      .where(eq(authRole.roleId, existing.roleId));
    return existing.roleId;
  }
  const [row] = await db
    .insert(authRole)
    .values({ name, description, key })
    .returning();
  return row.roleId;
}

async function setRolePermissions(
  roleId: number,
  codes: string[],
  codeToId: Map<string, number>,
  level: 'ro' | 'rw' = 'rw',
) {
  await db
    .delete(authRolePermissions)
    .where(eq(authRolePermissions.roleId, roleId));
  for (const code of codes) {
    const permissionId = codeToId.get(code);
    if (!permissionId) continue;
    await db.insert(authRolePermissions).values({
      roleId,
      permissionId,
      rw: level,
    });
  }
}

async function ensureUserWithRole(input: {
  email: string;
  password: string;
  name: string;
  realname: string;
  roleId: number;
}) {
  let [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, input.email))
    .limit(1);

  if (!existing) {
    const created = await createCredentialUser({
      email: input.email,
      password: input.password,
      name: input.name,
    });
    await db
      .update(user)
      .set({
        realname: input.realname,
        isSuperAdmin: false,
        updatedAt: new Date(),
      })
      .where(eq(user.id, created.id));
    existing = (
      await db.select().from(user).where(eq(user.id, created.id)).limit(1)
    )[0];
    console.log(`User created: ${input.email}`);
  } else {
    await db
      .update(user)
      .set({
        realname: input.realname,
        name: input.name,
        isSuperAdmin: false,
        updatedAt: new Date(),
      })
      .where(eq(user.id, existing.id));
    console.log(`User exists: ${input.email}`);
  }

  await db
    .delete(authUserRoles)
    .where(eq(authUserRoles.userId, existing.id));
  await db.insert(authUserRoles).values({
    userId: existing.id,
    roleId: input.roleId,
  });

  return existing.id;
}

async function ensureWallet(userId: string) {
  const [existing] = await db
    .select()
    .from(financeWallet)
    .where(eq(financeWallet.userId, userId))
    .limit(1);
  if (existing) return;
  await db.insert(financeWallet).values({
    userId,
    walletCode: `W${userId.slice(0, 8).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
    currencyCode: WALLET_CURRENCY,
    balance: '0.00',
  });
  console.log(`Wallet created for ${userId}`);
}

async function ensureSiteDefaults() {
  const [settings] = await db
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.id, SITE_SETTINGS_ROW_ID))
    .limit(1);
  if (!settings) {
    await db.insert(siteSettings).values({
      id: SITE_SETTINGS_ROW_ID,
      defaultCountryCode: 'US',
      defaultCurrencyCode: 'USD',
    });
    console.log('site_settings seeded');
  }

  const [fx] = await db
    .select()
    .from(exchangeRateSettings)
    .where(eq(exchangeRateSettings.id, EXCHANGE_RATE_SETTINGS_ROW_ID))
    .limit(1);
  if (!fx) {
    await db.insert(exchangeRateSettings).values({
      id: EXCHANGE_RATE_SETTINGS_ROW_ID,
      baseCurrencyCode: WALLET_CURRENCY,
    });
    console.log('exchange_rate_settings seeded');
  }

  const rates = await db.select().from(exchangeRates);
  if (rates.length === 0) {
    const now = new Date();
    await db.insert(exchangeRates).values(
      DEFAULT_EXCHANGE_RATES.map((row) => ({
        currencyCode: row.currencyCode,
        rateToBase: row.rateToBase,
        createdAt: now,
        updatedAt: now,
      })),
    );
    console.log('exchange_rates seeded');
  }
}

async function main() {
  const codeToId = await upsertPermissions();
  await ensureSiteDefaults();
  await ensureAdminUser();

  const dealerRoleId = await upsertRole(
    '经销商',
    '只能查看自己的钱包与账户变动、创建预约订单',
    'dealer',
  );
  const opsRoleId = await upsertRole(
    '运营专员',
    '财务与履约运营：充值/扣费审核、履约代拍',
    'ops',
  );

  await setRolePermissions(
    dealerRoleId,
    [
      'wallet',
      'trade_log',
      'goods',
      'goods_reserve_create',
      'goods_reserve_order',
      'goods_history_order',
    ],
    codeToId,
    'rw',
  );
  await setRolePermissions(
    opsRoleId,
    [
      'finance',
      'wallet',
      'trade_log',
      'recharge',
      'deduction',
      'site',
      'exchange_rate',
      'site_config',
      'goods',
      'goods_fulfill_order',
      'goods_history_order',
    ],
    codeToId,
    'rw',
  );

  const dealerId = await ensureUserWithRole({
    email: 'dealer@local.dev',
    password: process.env.DEALER_SEED_PASSWORD || 'Dealer@123456',
    name: 'dealer',
    realname: '示例经销商',
    roleId: dealerRoleId,
  });
  await ensureWallet(dealerId);

  await ensureUserWithRole({
    email: 'ops@local.dev',
    password: process.env.OPS_SEED_PASSWORD || 'Ops@123456',
    name: 'ops',
    realname: '运营专员',
    roleId: opsRoleId,
  });

  console.log('Seed complete');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
