import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  authRole,
  authUserRoles,
  financeDeduction,
  financeRecharge,
  financeTradeLog,
  financeWallet,
  user,
} from '../db/schema.js';
import { PermissionService } from '../rbac/permission.service.js';
import { ROLE_KEY_DEALER } from '../rbac/role-key.js';
import { money, genNo } from '../common/format.js';
import { pageResult, parsePageQuery, type PageQuery } from '../common/pagination.js';
import { WALLET_CURRENCY } from '../site/exchange-rate-config.js';
import { SiteService } from '../site/site.service.js';

const TYPE_RECHARGE = 5;
const TYPE_DEDUCTION = 6;
const SOURCE_OFFLINE = 7;
const VERIFY_PENDING = 0;
const VERIFY_APPROVED = 1;
const VERIFY_REJECTED = 2;

@Injectable()
export class FinanceService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly siteService: SiteService,
  ) {}

  async isDealerUser(userId: string): Promise<boolean> {
    return this.permissionService.isDealerUser(userId);
  }

  /** Resolve scoped dealer userId for list queries. */
  async resolveScopeUserId(
    actorId: string,
    requestedUserId?: string | null,
  ): Promise<string | undefined> {
    if (await this.isDealerUser(actorId)) {
      return actorId;
    }
    return requestedUserId || undefined;
  }

  async ensureWallet(userId: string) {
    const [existing] = await db
      .select()
      .from(financeWallet)
      .where(eq(financeWallet.userId, userId))
      .limit(1);
    if (existing) return existing;

    const [u] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!u) throw new NotFoundException('用户不存在');

    const [created] = await db
      .insert(financeWallet)
      .values({
        userId,
        walletCode: `W${userId.slice(0, 8).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
        currencyCode: WALLET_CURRENCY,
        balance: '0.00',
      })
      .returning();
    return created;
  }

  private async resolveCurrencyAndBase(
    amount: number,
    currencyCode?: string,
  ): Promise<{ currencyCode: string; amountBase: number }> {
    let code = currencyCode?.trim();
    if (!code) {
      const settings = await this.siteService.getSettings();
      code = settings.defaultCurrencyCode;
    }
    return this.siteService.convertToWalletBase(amount, code);
  }

  async listDealers() {
    const rows = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        realname: user.realname,
      })
      .from(user)
      .innerJoin(authUserRoles, eq(authUserRoles.userId, user.id))
      .innerJoin(authRole, eq(authRole.roleId, authUserRoles.roleId))
      .where(eq(authRole.key, ROLE_KEY_DEALER));

    const map = new Map<string, (typeof rows)[0]>();
    for (const r of rows) map.set(r.id, r);
    return [...map.values()];
  }

  async listWallets(actorId: string, filterUserId?: string) {
    const scope = await this.resolveScopeUserId(actorId, filterUserId);
    const wallets = scope
      ? await db
          .select()
          .from(financeWallet)
          .where(eq(financeWallet.userId, scope))
          .orderBy(desc(financeWallet.createTime))
      : await db
          .select()
          .from(financeWallet)
          .orderBy(desc(financeWallet.createTime));

    if (wallets.length === 0 && scope) {
      const w = await this.ensureWallet(scope);
      wallets.push(w);
    }

    const userIds = [...new Set(wallets.map((w) => w.userId))];
    const userMap = new Map<
      string,
      { id: string; name: string; email: string; realname: string | null }
    >();
    if (userIds.length > 0) {
      const users = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          realname: user.realname,
        })
        .from(user)
        .where(inArray(user.id, userIds));
      for (const u of users) userMap.set(u.id, u);
    }

    return wallets.map((w) => ({
      ...w,
      user: userMap.get(w.userId) ?? null,
    }));
  }

  async getWalletDetail(actorId: string, walletId: number) {
    const [w] = await db
      .select()
      .from(financeWallet)
      .where(eq(financeWallet.id, walletId))
      .limit(1);
    if (!w) throw new NotFoundException('钱包不存在');

    if (await this.isDealerUser(actorId)) {
      if (w.userId !== actorId) {
        throw new ForbiddenException('无权查看该钱包');
      }
    }

    const [u] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        realname: user.realname,
      })
      .from(user)
      .where(eq(user.id, w.userId))
      .limit(1);

    return { ...w, user: u ?? null };
  }

  async listTradeLogs(
    actorId: string,
    query: {
      userId?: string;
      direction?: string;
      createTimeStart?: string;
      createTimeEnd?: string;
    } & PageQuery,
  ) {
    const { page, pageSize, offset } = parsePageQuery(query);
    const scope = await this.resolveScopeUserId(actorId, query.userId);
    const conditions = [];
    if (scope) conditions.push(eq(financeTradeLog.userId, scope));
    if (query.direction === 'in' || query.direction === 'out') {
      conditions.push(eq(financeTradeLog.direction, query.direction));
    }
    if (query.createTimeStart) {
      conditions.push(
        gte(financeTradeLog.createTime, new Date(query.createTimeStart)),
      );
    }
    if (query.createTimeEnd) {
      conditions.push(
        lte(financeTradeLog.createTime, new Date(query.createTimeEnd)),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(financeTradeLog)
      .where(where);
    const total = Number(totalRow?.value ?? 0);

    const rows = await db
      .select()
      .from(financeTradeLog)
      .where(where)
      .orderBy(desc(financeTradeLog.createTime))
      .limit(pageSize)
      .offset(offset);

    if (rows.length === 0) {
      return pageResult([], total, page, pageSize);
    }

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const userMap = new Map<
      string,
      { id: string; name: string; email: string; realname: string | null }
    >();
    if (userIds.length > 0) {
      const users = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          realname: user.realname,
        })
        .from(user)
        .where(inArray(user.id, userIds));
      for (const u of users) userMap.set(u.id, u);
    }

    const items = rows.map((row) => {
      const u = userMap.get(row.userId);
      return {
        ...row,
        userName: u?.realname || u?.name || u?.email || row.userId,
      };
    });
    return pageResult(items, total, page, pageSize);
  }

  async listRecharges(
    actorId: string,
    query: { userId?: string; isVerify?: string } & PageQuery,
  ) {
    if (await this.isDealerUser(actorId)) {
      throw new ForbiddenException('无权查看充值审核');
    }

    const { page, pageSize, offset } = parsePageQuery(query);
    const conditions = [];
    if (query.userId) conditions.push(eq(financeRecharge.userId, query.userId));
    if (query.isVerify !== undefined && query.isVerify !== '') {
      conditions.push(eq(financeRecharge.isVerify, Number(query.isVerify)));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(financeRecharge)
      .where(where);
    const total = Number(totalRow?.value ?? 0);

    const rows = await db
      .select()
      .from(financeRecharge)
      .where(where)
      .orderBy(desc(financeRecharge.createTime))
      .limit(pageSize)
      .offset(offset);

    const nameIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.createAdminId, r.verifyAdminId].filter(
            (id): id is string => !!id,
          ),
        ),
      ),
    ];
    const nameMap = new Map<string, string>();
    if (nameIds.length > 0) {
      const users = await db
        .select({
          id: user.id,
          name: user.name,
          realname: user.realname,
        })
        .from(user)
        .where(inArray(user.id, nameIds));
      for (const u of users) {
        nameMap.set(u.id, u.realname || u.name || u.id);
      }
    }

    const items = rows.map((row) => ({
      ...row,
      createAdminName:
        nameMap.get(row.createAdminId) || row.createAdminId,
      verifyAdminName: row.verifyAdminId
        ? nameMap.get(row.verifyAdminId) || null
        : null,
    }));
    return pageResult(items, total, page, pageSize);
  }

  async createRecharge(
    actorId: string,
    body: {
      userId: string;
      amount: number;
      currencyCode?: string;
      remark?: string;
    },
  ) {
    if (await this.isDealerUser(actorId)) {
      throw new ForbiddenException('无权提交充值');
    }
    if (!body.userId) throw new BadRequestException('请选择经销商');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('金额必须大于 0');
    }

    const [dealer] = await db
      .select()
      .from(user)
      .where(eq(user.id, body.userId))
      .limit(1);
    if (!dealer) throw new NotFoundException('经销商不存在');

    const isDealer = await this.isDealerUser(body.userId);
    if (!isDealer) {
      const dealers = await this.listDealers();
      if (!dealers.some((d) => d.id === body.userId)) {
        throw new BadRequestException('只能给经销商用户充值');
      }
    }

    const { currencyCode, amountBase } = await this.resolveCurrencyAndBase(
      amount,
      body.currencyCode,
    );

    await this.ensureWallet(body.userId);

    const [row] = await db
      .insert(financeRecharge)
      .values({
        rechargeNumber: genNo('RC'),
        userId: body.userId,
        userName: dealer.realname || dealer.name || dealer.email,
        currencyCode,
        amount: money(amount),
        amountBase: money(amountBase),
        remark: body.remark ?? null,
        isVerify: VERIFY_PENDING,
        createAdminId: actorId,
      })
      .returning();

    return row;
  }

  async verifyRecharge(
    actorId: string,
    body: { rechargeNumber: string; verify: boolean; verifyRemark?: string },
  ) {
    if (await this.isDealerUser(actorId)) {
      throw new ForbiddenException('无权审核充值');
    }
    if (!body.rechargeNumber) {
      throw new BadRequestException('缺少充值单号');
    }

    const [row] = await db
      .select()
      .from(financeRecharge)
      .where(eq(financeRecharge.rechargeNumber, body.rechargeNumber))
      .limit(1);
    if (!row) throw new NotFoundException('充值单不存在');
    if (row.isVerify !== VERIFY_PENDING) {
      throw new BadRequestException('该单已审核');
    }
    if (
      row.createAdminId === actorId &&
      !(await this.permissionService.isSuperAdmin(actorId))
    ) {
      throw new ForbiddenException('不能审核自己提交的充值单');
    }

    const approved = !!body.verify;
    const now = new Date();

    if (!approved) {
      const [updated] = await db
        .update(financeRecharge)
        .set({
          isVerify: VERIFY_REJECTED,
          verifyAdminId: actorId,
          verifyRemark: body.verifyRemark ?? null,
          verifyTime: now,
          updateTime: now,
        })
        .where(eq(financeRecharge.id, row.id))
        .returning();
      return updated;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(financeRecharge)
        .set({
          isVerify: VERIFY_APPROVED,
          verifyAdminId: actorId,
          verifyRemark: body.verifyRemark ?? null,
          verifyTime: now,
          updateTime: now,
        })
        .where(eq(financeRecharge.id, row.id));

      let [wallet] = await tx
        .select()
        .from(financeWallet)
        .where(eq(financeWallet.userId, row.userId))
        .limit(1);
      if (!wallet) {
        const [created] = await tx
          .insert(financeWallet)
          .values({
            userId: row.userId,
            walletCode: `W${row.userId.slice(0, 8).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
            currencyCode: WALLET_CURRENCY,
            balance: '0.00',
          })
          .returning();
        wallet = created;
      }

      const before = Number(wallet.balance);
      const delta = Number(row.amountBase);
      const after = money(before + delta);

      const [log] = await tx
        .insert(financeTradeLog)
        .values({
          tradeNumber: genNo('TL'),
          userId: row.userId,
          direction: 'in',
          currencyCode: row.currencyCode,
          amount: money(row.amount),
          amountBase: money(delta),
          balance: after,
          type: TYPE_RECHARGE,
          source: SOURCE_OFFLINE,
          status: 1,
          orderNumber: row.rechargeNumber,
          info: `人工充值入账 (${row.currencyCode} ${money(row.amount)} → ${WALLET_CURRENCY} ${money(delta)})`,
        })
        .returning();

      await tx
        .update(financeWallet)
        .set({
          balance: after,
          lastTradeId: log.id,
          lastTradeBalance: money(before),
          lastTradeTime: now,
          lastTradeAmount: money(delta),
          updateTime: now,
        })
        .where(eq(financeWallet.id, wallet.id));
    });

    const [updated] = await db
      .select()
      .from(financeRecharge)
      .where(eq(financeRecharge.id, row.id))
      .limit(1);
    return updated;
  }

  async listDeductions(
    actorId: string,
    query: { userId?: string } & PageQuery,
  ) {
    if (await this.isDealerUser(actorId)) {
      throw new ForbiddenException('无权查看扣费审核');
    }
    const { page, pageSize, offset } = parsePageQuery(query);
    const conditions = [];
    if (query.userId) {
      conditions.push(eq(financeDeduction.userId, query.userId));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(financeDeduction)
      .where(where);
    const total = Number(totalRow?.value ?? 0);

    const rows = await db
      .select()
      .from(financeDeduction)
      .where(where)
      .orderBy(desc(financeDeduction.createTime))
      .limit(pageSize)
      .offset(offset);

    const nameIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.createAdminId, r.verifyAdminId].filter(
            (id): id is string => !!id,
          ),
        ),
      ),
    ];
    const nameMap = new Map<string, string>();
    if (nameIds.length > 0) {
      const users = await db
        .select({
          id: user.id,
          name: user.name,
          realname: user.realname,
        })
        .from(user)
        .where(inArray(user.id, nameIds));
      for (const u of users) {
        nameMap.set(u.id, u.realname || u.name || u.id);
      }
    }

    const items = rows.map((row) => ({
      ...row,
      createAdminName: nameMap.get(row.createAdminId) || null,
      verifyAdminName: row.verifyAdminId
        ? nameMap.get(row.verifyAdminId) || null
        : null,
      order: row.orderId
        ? { id: row.orderId, orderNumber: row.orderNumber }
        : null,
    }));
    return pageResult(items, total, page, pageSize);
  }

  async createDeduction(
    actorId: string,
    body: {
      userId: string;
      amount: number;
      currencyCode?: string;
      remark?: string;
    },
  ) {
    if (await this.isDealerUser(actorId)) {
      throw new ForbiddenException('无权提交扣费');
    }
    if (!body.userId) throw new BadRequestException('请选择经销商');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('金额必须大于 0');
    }

    const [dealer] = await db
      .select()
      .from(user)
      .where(eq(user.id, body.userId))
      .limit(1);
    if (!dealer) throw new NotFoundException('经销商不存在');

    const dealers = await this.listDealers();
    if (!dealers.some((d) => d.id === body.userId)) {
      throw new BadRequestException('只能对经销商用户扣费');
    }

    const { currencyCode, amountBase } = await this.resolveCurrencyAndBase(
      amount,
      body.currencyCode,
    );

    await this.ensureWallet(body.userId);

    const [row] = await db
      .insert(financeDeduction)
      .values({
        deductionNumber: genNo('DD'),
        userId: body.userId,
        userName: dealer.realname || dealer.name || dealer.email,
        currencyCode,
        amount: money(amount),
        amountBase: money(amountBase),
        remark: body.remark ?? null,
        isVerify: VERIFY_PENDING,
        createAdminId: actorId,
      })
      .returning();

    return row;
  }

  async verifyDeduction(
    actorId: string,
    body: { deductionNumber: string; verify: boolean; verifyRemark?: string },
  ) {
    if (await this.isDealerUser(actorId)) {
      throw new ForbiddenException('无权审核扣费');
    }
    const [row] = await db
      .select()
      .from(financeDeduction)
      .where(eq(financeDeduction.deductionNumber, body.deductionNumber))
      .limit(1);
    if (!row) throw new NotFoundException('扣费单不存在');
    if (row.isVerify !== VERIFY_PENDING) {
      throw new BadRequestException('该单已审核');
    }
    if (
      row.createAdminId === actorId &&
      !(await this.permissionService.isSuperAdmin(actorId))
    ) {
      throw new ForbiddenException('不能审核自己提交的扣费单');
    }

    const approved = !!body.verify;
    const now = new Date();

    if (!approved) {
      const [updated] = await db
        .update(financeDeduction)
        .set({
          isVerify: VERIFY_REJECTED,
          verifyAdminId: actorId,
          verifyRemark: body.verifyRemark ?? null,
          verifyTime: now,
          updateTime: now,
        })
        .where(eq(financeDeduction.id, row.id))
        .returning();
      return updated;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(financeDeduction)
        .set({
          isVerify: VERIFY_APPROVED,
          verifyAdminId: actorId,
          verifyRemark: body.verifyRemark ?? null,
          verifyTime: now,
          updateTime: now,
        })
        .where(eq(financeDeduction.id, row.id));

      let [wallet] = await tx
        .select()
        .from(financeWallet)
        .where(eq(financeWallet.userId, row.userId))
        .limit(1);
      if (!wallet) {
        throw new BadRequestException('钱包不存在，无法扣费');
      }
      const before = Number(wallet.balance);
      const delta = Number(row.amountBase);
      if (before < delta) {
        throw new BadRequestException('余额不足');
      }
      const after = money(before - delta);
      const [log] = await tx
        .insert(financeTradeLog)
        .values({
          tradeNumber: genNo('TL'),
          userId: row.userId,
          direction: 'out',
          currencyCode: row.currencyCode,
          amount: money(row.amount),
          amountBase: money(delta),
          balance: after,
          type: TYPE_DEDUCTION,
          source: SOURCE_OFFLINE,
          status: 1,
          orderNumber: row.deductionNumber,
          info: `扣费出账 (${row.currencyCode} ${money(row.amount)} → ${WALLET_CURRENCY} ${money(delta)})`,
        })
        .returning();
      await tx
        .update(financeWallet)
        .set({
          balance: after,
          lastTradeId: log.id,
          lastTradeBalance: money(before),
          lastTradeTime: now,
          lastTradeAmount: money(-delta),
          updateTime: now,
        })
        .where(eq(financeWallet.id, wallet.id));
    });

    const [updated] = await db
      .select()
      .from(financeDeduction)
      .where(eq(financeDeduction.id, row.id))
      .limit(1);
    return updated;
  }
}
