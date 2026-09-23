import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { auth } from '../auth/auth.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { FinanceService } from './finance.service.js';

@Controller('api/finance')
@UseGuards(PermissionGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('dealers')
  @RequirePermission('recharge', 'ro')
  listDealers() {
    return this.financeService.listDealers();
  }

  @Get('wallet/list')
  @RequirePermission('wallet', 'ro')
  listWallets(
    @Session() session: UserSession<typeof auth>,
    @Query('userId') userId?: string,
  ) {
    return this.financeService.listWallets(session.user.id, userId);
  }

  @Get('wallet/detail')
  @RequirePermission('wallet', 'ro')
  walletDetail(
    @Session() session: UserSession<typeof auth>,
    @Query('walletId', ParseIntPipe) walletId: number,
  ) {
    return this.financeService.getWalletDetail(session.user.id, walletId);
  }

  @Get('trade/log')
  @RequirePermission('trade_log', 'ro')
  tradeLogs(
    @Session() session: UserSession<typeof auth>,
    @Query('userId') userId?: string,
    @Query('direction') direction?: string,
    @Query('createTimeStart') createTimeStart?: string,
    @Query('createTimeEnd') createTimeEnd?: string,
  ) {
    return this.financeService.listTradeLogs(session.user.id, {
      userId,
      direction,
      createTimeStart,
      createTimeEnd,
    });
  }

  @Get('recharge/list')
  @RequirePermission('recharge', 'ro')
  rechargeList(
    @Session() session: UserSession<typeof auth>,
    @Query('userId') userId?: string,
    @Query('isVerify') isVerify?: string,
  ) {
    return this.financeService.listRecharges(session.user.id, {
      userId,
      isVerify,
    });
  }

  @Post('recharge')
  @RequirePermission('recharge', 'rw')
  createRecharge(
    @Session() session: UserSession<typeof auth>,
    @Body()
    body: {
      userId: string;
      amount: number;
      currencyCode?: string;
      remark?: string;
    },
  ) {
    return this.financeService.createRecharge(session.user.id, body);
  }

  @Put('recharge/verify')
  @RequirePermission('recharge', 'rw')
  verifyRecharge(
    @Session() session: UserSession<typeof auth>,
    @Body()
    body: { rechargeNumber: string; verify: boolean; verifyRemark?: string },
  ) {
    return this.financeService.verifyRecharge(session.user.id, body);
  }

  @Get('deduction/list')
  @RequirePermission('deduction', 'ro')
  deductionList(
    @Session() session: UserSession<typeof auth>,
    @Query('userId') userId?: string,
  ) {
    return this.financeService.listDeductions(session.user.id, { userId });
  }

  @Post('deduction')
  @RequirePermission('deduction', 'rw')
  createDeduction(
    @Session() session: UserSession<typeof auth>,
    @Body()
    body: {
      userId: string;
      amount: number;
      currencyCode?: string;
      remark?: string;
    },
  ) {
    return this.financeService.createDeduction(session.user.id, body);
  }

  @Put('deduction/verify')
  @RequirePermission('deduction', 'rw')
  verifyDeduction(
    @Session() session: UserSession<typeof auth>,
    @Body()
    body: { deductionNumber: string; verify: boolean; verifyRemark?: string },
  ) {
    return this.financeService.verifyDeduction(session.user.id, body);
  }
}
