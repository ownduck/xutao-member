import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { auth } from '../auth/auth.js';
import { PermissionGuard } from '../rbac/permission.guard.js';
import { RequirePermission } from '../rbac/require-permission.decorator.js';
import { GoodsService } from './goods.service.js';

@Controller('api/goods')
@UseGuards(PermissionGuard)
export class GoodsController {
  constructor(private readonly goodsService: GoodsService) {}

  @Get('orders/template')
  @RequirePermission('goods_reserve_create', 'ro')
  downloadTemplate(@Res() res: Response) {
    const buf = this.goodsService.buildTemplateBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="goods-reserve-template.xlsx"',
    );
    res.send(buf);
  }

  @Get('orders/reserve')
  @RequirePermission('goods_reserve_order', 'ro')
  listReserve(
    @Session() session: UserSession<typeof auth>,
    @Query('status') status?: string,
  ) {
    return this.goodsService.listOrders(session.user.id, {
      scope: 'reserve',
      status,
    });
  }

  @Get('orders/fulfill')
  @RequirePermission('goods_fulfill_order', 'ro')
  listFulfill(
    @Session() session: UserSession<typeof auth>,
    @Query('dealerUserId') dealerUserId?: string,
    @Query('status') status?: string,
  ) {
    return this.goodsService.listOrders(session.user.id, {
      scope: 'fulfill',
      dealerUserId,
      status,
    });
  }

  @Get('orders/history')
  @RequirePermission('goods_history_order', 'ro')
  listHistory(
    @Session() session: UserSession<typeof auth>,
    @Query('dealerUserId') dealerUserId?: string,
  ) {
    return this.goodsService.listOrders(session.user.id, {
      scope: 'history',
      dealerUserId,
    });
  }

  @Get('orders/:id')
  detail(
    @Session() session: UserSession<typeof auth>,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.goodsService.getOrderDetail(session.user.id, id);
  }

  @Post('orders/import')
  @RequirePermission('goods_reserve_create', 'rw')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async import(
    @Session() session: UserSession<typeof auth>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { dealerRemark?: string },
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请上传 Excel 文件');
    }
    const rows = this.goodsService.parseImportFile(file.buffer);
    return this.goodsService.importOrder(
      session.user.id,
      rows,
      body.dealerRemark,
    );
  }

  @Put('orders/:id')
  update(
    @Session() session: UserSession<typeof auth>,
    @Param('id', ParseIntPipe) id: number,
    @Body()
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
    return this.goodsService.updateOrder(session.user.id, id, body);
  }

  @Post('orders/:id/items/:itemId/sync-price')
  @RequirePermission('goods_reserve_order', 'rw')
  syncItemPrice(
    @Session() session: UserSession<typeof auth>,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.goodsService.syncItemPrice(session.user.id, id, itemId);
  }

  @Post('orders/:id/sync-prices')
  @RequirePermission('goods_reserve_order', 'rw')
  syncPrices(
    @Session() session: UserSession<typeof auth>,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { mode?: 'all' | 'empty' },
  ) {
    const mode = body?.mode === 'empty' ? 'empty' : 'all';
    return this.goodsService.syncPrices(session.user.id, id, mode);
  }

  @Post('orders/:id/submit-fulfill')
  @RequirePermission('goods_reserve_order', 'rw')
  submitFulfill(
    @Session() session: UserSession<typeof auth>,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.goodsService.submitFulfill(session.user.id, id);
  }

  @Post('orders/:id/submit-complete')
  @RequirePermission('goods_fulfill_order', 'rw')
  submitComplete(
    @Session() session: UserSession<typeof auth>,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.goodsService.submitComplete(session.user.id, id);
  }
}
