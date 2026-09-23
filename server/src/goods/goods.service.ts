import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { db } from '../db/index.js';
import {
  financeDeduction,
  goodsOrder,
  goodsOrderItem,
  user,
} from '../db/schema.js';
import { FinanceService } from '../finance/finance.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { SiteService } from '../site/site.service.js';
import { AmazonPriceService } from './amazon-price.service.js';
import {
  FULFILL_LIST_STATUSES,
  HISTORY_LIST_STATUSES,
  ORDER_STATUS,
  RESERVE_LIST_STATUSES,
  computeFulfillStatus,
  type OrderStatus,
} from './order-status.js';
import { convertViaBase } from '../site/currency-exchange.js';
import { WALLET_CURRENCY } from '../site/exchange-rate-config.js';
import { errorMessage, genNo, money } from '../common/format.js';

function computePriceStatus(
  items: Array<{ unitPrice?: string | null }>,
): number {
  if (!items.length) return 0;
  const allFilled = items.every(
    (i) => i.unitPrice != null && Number(i.unitPrice) >= 0,
  );
  return allFilled ? 1 : 0;
}

type ImportRow = { amazonUrl: string; reserveQty: number };

@Injectable()
export class GoodsService {
  private readonly logger = new Logger(GoodsService.name);

  constructor(
    private readonly permissionService: PermissionService,
    private readonly siteService: SiteService,
    private readonly financeService: FinanceService,
    private readonly amazonPriceService: AmazonPriceService,
  ) {}

  buildTemplateBuffer(): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['url', '数量'],
      ['https://www.amazon.com/dp/EXAMPLE', 1],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, '预约');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  parseImportFile(buffer: Buffer): ImportRow[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new BadRequestException('Excel 为空');
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (!rows.length) throw new BadRequestException('没有数据行');

    const out: ImportRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = Object.keys(row);
      const urlKey =
        keys.find((k) => /^url$/i.test(k.trim())) ||
        keys.find((k) => /url|链接|地址/i.test(k));
      const qtyKey =
        keys.find((k) => /^(数量|qty|quantity)$/i.test(k.trim())) ||
        keys.find((k) => /数量|qty|quantity/i.test(k));
      const url = String(urlKey ? row[urlKey] : '').trim();
      const qtyRaw = qtyKey ? row[qtyKey] : '';
      const qty = Number(qtyRaw);
      if (!url) {
        throw new BadRequestException(`第 ${i + 2} 行缺少 url`);
      }
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new BadRequestException(`第 ${i + 2} 行数量必须为正整数`);
      }
      out.push({ amazonUrl: url, reserveQty: qty });
    }
    return out;
  }

  async importOrder(
    actorId: string,
    rows: ImportRow[],
    dealerRemark?: string,
  ) {
    if (!(await this.permissionService.isDealerUser(actorId))) {
      if (!(await this.permissionService.isSuperAdmin(actorId))) {
        throw new ForbiddenException('仅经销商可创建预约');
      }
    }
    if (!rows.length) throw new BadRequestException('至少一行商品');

    const settings = await this.siteService.getSettings();
    const currencyCode = settings.defaultCurrencyCode;
    const orderNumber = genNo('GO');
    const now = new Date();

    const created = await db.transaction(async (tx) => {
      const [order] = await tx
        .insert(goodsOrder)
        .values({
          orderNumber,
          dealerUserId: actorId,
          status: ORDER_STATUS.RESERVING,
          currencyCode,
          priceStatus: 0,
          dealerRemark: dealerRemark?.trim() || null,
          createTime: now,
          updateTime: now,
        })
        .returning();

      await tx.insert(goodsOrderItem).values(
        rows.map((r, idx) => ({
          orderId: order.id,
          amazonUrl: r.amazonUrl,
          reserveQty: r.reserveQty,
          fulfillQty: 0,
          sort: idx,
          createTime: now,
          updateTime: now,
        })),
      );
      return order;
    });

    return this.getOrderDetail(actorId, created.id);
  }

  private async assertCanView(
    actorId: string,
    order: typeof goodsOrder.$inferSelect,
  ) {
    const isDealer = await this.permissionService.isDealerUser(actorId);
    const isOps = await this.permissionService.isOpsUser(actorId);
    const isSuper = await this.permissionService.isSuperAdmin(actorId);
    if (isSuper || isOps) return;
    if (isDealer && order.dealerUserId === actorId) return;
    throw new ForbiddenException('无权查看该订单');
  }

  async listOrders(
    actorId: string,
    query: {
      scope: 'reserve' | 'fulfill' | 'history';
      dealerUserId?: string;
      status?: string;
    },
  ) {
    const isDealer = await this.permissionService.isDealerUser(actorId);
    const isOps = await this.permissionService.isOpsUser(actorId);
    const isSuper = await this.permissionService.isSuperAdmin(actorId);

    let allowed: OrderStatus[];
    if (query.scope === 'reserve') {
      if (!isDealer && !isSuper) {
        throw new ForbiddenException('无权查看预约订单');
      }
      allowed = RESERVE_LIST_STATUSES;
    } else if (query.scope === 'fulfill') {
      if (!isOps && !isSuper) {
        throw new ForbiddenException('无权查看履约订单');
      }
      allowed = FULFILL_LIST_STATUSES;
    } else {
      allowed = HISTORY_LIST_STATUSES;
      if (!isDealer && !isOps && !isSuper) {
        throw new ForbiddenException('无权查看历史订单');
      }
    }

    const conditions = [inArray(goodsOrder.status, allowed)];
    if (query.status && allowed.includes(query.status as OrderStatus)) {
      conditions.push(eq(goodsOrder.status, query.status));
    }

    if (query.scope === 'reserve' || (query.scope === 'history' && isDealer && !isOps && !isSuper)) {
      conditions.push(eq(goodsOrder.dealerUserId, actorId));
    } else if (query.dealerUserId && (isOps || isSuper)) {
      conditions.push(eq(goodsOrder.dealerUserId, query.dealerUserId));
    }

    const rows = await db
      .select()
      .from(goodsOrder)
      .where(and(...conditions))
      .orderBy(desc(goodsOrder.createTime));

    const result = [];
    for (const row of rows) {
      const [dealer] = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          realname: user.realname,
        })
        .from(user)
        .where(eq(user.id, row.dealerUserId))
        .limit(1);
      const items = await db
        .select()
        .from(goodsOrderItem)
        .where(eq(goodsOrderItem.orderId, row.id));
      result.push({
        ...row,
        itemCount: items.length,
        reserveQtyTotal: items.reduce((s, i) => s + i.reserveQty, 0),
        fulfillQtyTotal: items.reduce((s, i) => s + i.fulfillQty, 0),
        dealer: dealer ?? null,
      });
    }
    return result;
  }

  async getOrderDetail(actorId: string, orderId: number) {
    const [order] = await db
      .select()
      .from(goodsOrder)
      .where(eq(goodsOrder.id, orderId))
      .limit(1);
    if (!order) throw new NotFoundException('订单不存在');
    await this.assertCanView(actorId, order);

    const items = await db
      .select()
      .from(goodsOrderItem)
      .where(eq(goodsOrderItem.orderId, orderId))
      .orderBy(asc(goodsOrderItem.sort));

    const [dealer] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        realname: user.realname,
      })
      .from(user)
      .where(eq(user.id, order.dealerUserId))
      .limit(1);

    let deduction: typeof financeDeduction.$inferSelect | null = null;
    if (order.deductionId) {
      const [d] = await db
        .select()
        .from(financeDeduction)
        .where(eq(financeDeduction.id, order.deductionId))
        .limit(1);
      deduction = d ?? null;
    }

    return { ...order, items, dealer: dealer ?? null, deduction };
  }

  async updateOrder(
    actorId: string,
    orderId: number,
    body: {
      dealerRemark?: string | null;
      items?: Array<{
        id: number;
        unitPrice?: number | null;
        reserveQty?: number;
        fulfillQty?: number;
      }>;
    },
  ) {
    const detail = await this.getOrderDetail(actorId, orderId);
    const isDealer = await this.permissionService.isDealerUser(actorId);
    const isOps = await this.permissionService.isOpsUser(actorId);
    const isSuper = await this.permissionService.isSuperAdmin(actorId);

    if (detail.status === ORDER_STATUS.RESERVING) {
      if (!isDealer && !isSuper) {
        throw new ForbiddenException('仅经销商可编辑预约中订单');
      }
      if (isDealer && detail.dealerUserId !== actorId) {
        throw new ForbiddenException('无权编辑');
      }

      const now = new Date();
      await db.transaction(async (tx) => {
        for (const item of body.items ?? []) {
          const patch: {
            unitPrice?: string | null;
            reserveQty?: number;
            updateTime: Date;
          } = { updateTime: now };

          if (item.reserveQty !== undefined) {
            const q = Number(item.reserveQty);
            if (!Number.isInteger(q) || q <= 0) {
              throw new BadRequestException('预约数量必须为正整数');
            }
            patch.reserveQty = q;
          }
          if (item.unitPrice !== undefined) {
            const price =
              item.unitPrice == null ? null : Number(item.unitPrice);
            if (price != null && (!Number.isFinite(price) || price < 0)) {
              throw new BadRequestException('单价无效');
            }
            patch.unitPrice = price == null ? null : money(price);
          }
          if (
            item.reserveQty === undefined &&
            item.unitPrice === undefined
          ) {
            continue;
          }
          await tx
            .update(goodsOrderItem)
            .set(patch)
            .where(
              and(
                eq(goodsOrderItem.id, item.id),
                eq(goodsOrderItem.orderId, orderId),
              ),
            );
        }

        const items = await tx
          .select()
          .from(goodsOrderItem)
          .where(eq(goodsOrderItem.orderId, orderId));
        const priceStatus = computePriceStatus(items);

        await tx
          .update(goodsOrder)
          .set({
            ...(body.dealerRemark !== undefined
              ? { dealerRemark: body.dealerRemark }
              : {}),
            priceStatus,
            updateTime: now,
          })
          .where(eq(goodsOrder.id, orderId));
      });
      return this.getOrderDetail(actorId, orderId);
    }

    if (
      detail.status === ORDER_STATUS.PENDING_FULFILL ||
      detail.status === ORDER_STATUS.PARTIAL_FULFILL ||
      detail.status === ORDER_STATUS.FULFILLED
    ) {
      if (!isOps && !isSuper) {
        throw new ForbiddenException('仅运营可编辑履约数量');
      }

      const now = new Date();
      const nextItems = detail.items.map((it) => {
        const patch = body.items?.find((p) => p.id === it.id);
        let fulfillQty = it.fulfillQty;
        if (patch?.fulfillQty !== undefined) {
          const q = Number(patch.fulfillQty);
          if (!Number.isInteger(q) || q < 0) {
            throw new BadRequestException('履约数量无效');
          }
          fulfillQty = q;
        }
        return {
          id: it.id,
          reserveQty: it.reserveQty,
          fulfillQty,
        };
      });

      const nextStatus = computeFulfillStatus(nextItems);

      await db.transaction(async (tx) => {
        for (const it of nextItems) {
          await tx
            .update(goodsOrderItem)
            .set({ fulfillQty: it.fulfillQty, updateTime: now })
            .where(
              and(
                eq(goodsOrderItem.id, it.id),
                eq(goodsOrderItem.orderId, orderId),
              ),
            );
        }
        await tx
          .update(goodsOrder)
          .set({ status: nextStatus, updateTime: now })
          .where(eq(goodsOrder.id, orderId));
      });
      return this.getOrderDetail(actorId, orderId);
    }

    throw new BadRequestException('当前状态不可编辑');
  }

  async submitFulfill(actorId: string, orderId: number) {
    const detail = await this.getOrderDetail(actorId, orderId);
    const isDealer = await this.permissionService.isDealerUser(actorId);
    const isSuper = await this.permissionService.isSuperAdmin(actorId);
    if (!isDealer && !isSuper) {
      throw new ForbiddenException('仅经销商可提交履约');
    }
    if (isDealer && detail.dealerUserId !== actorId) {
      throw new ForbiddenException('无权操作');
    }
    if (detail.status !== ORDER_STATUS.RESERVING) {
      throw new BadRequestException('仅预约中订单可提交履约');
    }
    const missing = detail.items.filter(
      (i) => i.unitPrice == null || Number(i.unitPrice) < 0,
    );
    if (missing.length || computePriceStatus(detail.items) !== 1) {
      throw new BadRequestException('请为全部商品填写单价后再提交');
    }

    await db
      .update(goodsOrder)
      .set({
        status: ORDER_STATUS.PENDING_FULFILL,
        priceStatus: 1,
        updateTime: new Date(),
      })
      .where(eq(goodsOrder.id, orderId));

    return this.getOrderDetail(actorId, orderId);
  }

  private async assertDealerCanEditReserving(
    actorId: string,
    order: { status: string; dealerUserId: string },
  ) {
    if (order.status !== ORDER_STATUS.RESERVING) {
      throw new BadRequestException('仅预约中订单可同步价格');
    }
    const isDealer = await this.permissionService.isDealerUser(actorId);
    const isSuper = await this.permissionService.isSuperAdmin(actorId);
    if (!isDealer && !isSuper) {
      throw new ForbiddenException('仅经销商可同步价格');
    }
    if (isDealer && order.dealerUserId !== actorId) {
      throw new ForbiddenException('无权操作');
    }
  }

  private async usdToOrderCurrency(
    usdPrice: number,
    orderCurrency: string,
  ): Promise<number> {
    const code = orderCurrency.toUpperCase();
    if (code === WALLET_CURRENCY) {
      return Number(usdPrice.toFixed(2));
    }
    const snapshot = await this.siteService.getSnapshot();
    const converted = convertViaBase(
      usdPrice,
      WALLET_CURRENCY,
      code,
      snapshot,
    );
    if (converted == null) {
      throw new BadRequestException(
        `缺少 ${WALLET_CURRENCY}→${code} 汇率，无法换算抓取价格`,
      );
    }
    return converted;
  }

  async syncItemPrice(actorId: string, orderId: number, itemId: number) {
    const detail = await this.getOrderDetail(actorId, orderId);
    await this.assertDealerCanEditReserving(actorId, detail);
    const item = detail.items.find((i) => i.id === itemId);
    if (!item) throw new NotFoundException('商品行不存在');

    const usdPrice = await this.amazonPriceService.fetchUsdPrice(
      item.amazonUrl,
    );
    const unitPrice = await this.usdToOrderCurrency(
      usdPrice,
      detail.currencyCode,
    );
    return {
      itemId,
      amazonUrl: item.amazonUrl,
      usdPrice,
      unitPrice,
      currencyCode: detail.currencyCode,
      ok: true as const,
    };
  }

  async syncPrices(
    actorId: string,
    orderId: number,
    mode: 'all' | 'empty',
  ) {
    const detail = await this.getOrderDetail(actorId, orderId);
    await this.assertDealerCanEditReserving(actorId, detail);

    const targets = detail.items.filter((i) => {
      if (mode === 'all') return true;
      return i.unitPrice == null || i.unitPrice === '';
    });

    const results: Array<{
      itemId: number;
      amazonUrl: string;
      ok: boolean;
      usdPrice?: number;
      unitPrice?: number;
      currencyCode?: string;
      error?: string;
    }> = [];

    for (const item of targets) {
      try {
        const usdPrice = await this.amazonPriceService.fetchUsdPrice(
          item.amazonUrl,
        );
        const unitPrice = await this.usdToOrderCurrency(
          usdPrice,
          detail.currencyCode,
        );
        results.push({
          itemId: item.id,
          amazonUrl: item.amazonUrl,
          ok: true,
          usdPrice,
          unitPrice,
          currencyCode: detail.currencyCode,
        });
      } catch (err) {
        results.push({
          itemId: item.id,
          amazonUrl: item.amazonUrl,
          ok: false,
          error: errorMessage(err),
        });
      }
    }

    return { mode, results };
  }

  /**
   * Cron: fill empty unit prices on reserving orders with priceStatus=0.
   * Persists successes and recalculates priceStatus per order.
   */
  async autoSyncEmptyPrices(): Promise<{
    orders: number;
    itemsTried: number;
    itemsOk: number;
    itemsFail: number;
  }> {
    const orders = await db
      .select()
      .from(goodsOrder)
      .where(
        and(
          eq(goodsOrder.priceStatus, 0),
          eq(goodsOrder.status, ORDER_STATUS.RESERVING),
        ),
      )
      .orderBy(asc(goodsOrder.id));

    let itemsTried = 0;
    let itemsOk = 0;
    let itemsFail = 0;

    for (const order of orders) {
      const items = await db
        .select()
        .from(goodsOrderItem)
        .where(eq(goodsOrderItem.orderId, order.id))
        .orderBy(asc(goodsOrderItem.sort), asc(goodsOrderItem.id));

      const emptyItems = items.filter(
        (i) => i.unitPrice == null || i.unitPrice === '',
      );
      if (!emptyItems.length) {
        const priceStatus = computePriceStatus(items);
        if (priceStatus !== order.priceStatus) {
          await db
            .update(goodsOrder)
            .set({ priceStatus, updateTime: new Date() })
            .where(eq(goodsOrder.id, order.id));
        }
        continue;
      }

      for (const item of emptyItems) {
        itemsTried += 1;
        try {
          const usdPrice = await this.amazonPriceService.fetchUsdPrice(
            item.amazonUrl,
          );
          const unitPrice = await this.usdToOrderCurrency(
            usdPrice,
            order.currencyCode,
          );
          const now = new Date();
          await db
            .update(goodsOrderItem)
            .set({
              unitPrice: money(unitPrice),
              updateTime: now,
            })
            .where(eq(goodsOrderItem.id, item.id));
          item.unitPrice = money(unitPrice);
          itemsOk += 1;
          this.logger.log(
            `auto-sync order=${order.id} item=${item.id} usd=${usdPrice} → ${order.currencyCode} ${unitPrice}`,
          );
        } catch (err) {
          itemsFail += 1;
          this.logger.warn(
            `auto-sync failed order=${order.id} item=${item.id}: ${errorMessage(err)}`,
          );
        }
      }

      const refreshed = await db
        .select()
        .from(goodsOrderItem)
        .where(eq(goodsOrderItem.orderId, order.id));
      const priceStatus = computePriceStatus(refreshed);
      await db
        .update(goodsOrder)
        .set({ priceStatus, updateTime: new Date() })
        .where(eq(goodsOrder.id, order.id));
    }

    return {
      orders: orders.length,
      itemsTried,
      itemsOk,
      itemsFail,
    };
  }

  async submitComplete(actorId: string, orderId: number) {
    const isOps = await this.permissionService.isOpsUser(actorId);
    const isSuper = await this.permissionService.isSuperAdmin(actorId);
    if (!isOps && !isSuper) {
      throw new ForbiddenException('仅运营可提交完成');
    }

    const detail = await this.getOrderDetail(actorId, orderId);
    if (
      detail.status !== ORDER_STATUS.PARTIAL_FULFILL &&
      detail.status !== ORDER_STATUS.FULFILLED
    ) {
      throw new BadRequestException('仅部分履约或已履约订单可提交完成');
    }
    if (detail.deductionId) {
      throw new BadRequestException('已生成扣费单');
    }

    const billable = detail.items.filter((i) => i.fulfillQty > 0);
    if (!billable.length) {
      throw new BadRequestException('没有可扣费的履约商品');
    }

    let amount = 0;
    for (const it of billable) {
      const price = Number(it.unitPrice);
      if (!Number.isFinite(price) || price < 0) {
        throw new BadRequestException('存在无效单价');
      }
      amount += price * it.fulfillQty;
    }
    amount = Number(amount.toFixed(2));
    if (amount <= 0) {
      throw new BadRequestException('扣费金额必须大于 0');
    }

    const { amountBase } = await this.siteService.convertToWalletBase(
      amount,
      detail.currencyCode,
    );

    const [dealer] = await db
      .select()
      .from(user)
      .where(eq(user.id, detail.dealerUserId))
      .limit(1);
    if (!dealer) throw new NotFoundException('经销商不存在');

    await this.financeService.ensureWallet(detail.dealerUserId);

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [deduction] = await tx
        .insert(financeDeduction)
        .values({
          deductionNumber: genNo('DD'),
          userId: detail.dealerUserId,
          userName: dealer.realname || dealer.name || dealer.email,
          currencyCode: detail.currencyCode,
          amount: money(amount),
          amountBase: money(amountBase),
          remark: `预约订单 ${detail.orderNumber} 履约扣费`,
          isVerify: 0,
          orderId: detail.id,
          orderNumber: detail.orderNumber,
          createAdminId: actorId,
          createTime: now,
          updateTime: now,
        })
        .returning();

      await tx
        .update(goodsOrder)
        .set({
          status: ORDER_STATUS.COMPLETED,
          totalAmount: money(amount),
          totalAmountBase: money(amountBase),
          deductionId: deduction.id,
          updateTime: now,
        })
        .where(eq(goodsOrder.id, orderId));

      return deduction;
    });

    return {
      order: await this.getOrderDetail(actorId, orderId),
      deduction: result,
    };
  }
}
