import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { VendorGuard, VendorScopeId } from '../auth/vendor.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user';
import { VendorScopedRepository } from '../common/vendor-scoped.repository';
import { OrderService } from './order.service';
import type { OrderStatus } from './order-state-machine';

class UpdateStatusDto {
  @IsIn(['paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'])
  status!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Vendor order management. Guard order matters:
 *   JwtAuthGuard  -> authenticate, attach req.user
 *   RolesGuard    -> only vendor_*/admin roles
 *   VendorGuard   -> resolve + pin the active vendor scope (req.vendorScopeId)
 * Then every query goes through the scoped repository / scoped service so a
 * vendor can only ever touch their own orders.
 */
@Controller('vendor/orders')
@UseGuards(JwtAuthGuard, RolesGuard, VendorGuard)
@Roles('vendor_owner', 'vendor_staff', 'admin')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly repo: VendorScopedRepository,
  ) {}

  @Get()
  list(@VendorScopeId() vendorId: string, @Query('status') status?: OrderStatus) {
    return this.repo.listOrders(vendorId, status);
  }

  @Get(':id')
  getOne(@VendorScopeId() vendorId: string, @Param('id') id: string) {
    return this.repo.getOrderOrThrow(vendorId, id);
  }

  @Patch(':id/status')
  async updateStatus(
    @VendorScopeId() vendorId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    // vendorScopeId is passed into the service so the row lock + ownership check
    // happen INSIDE the same transaction as the transition.
    return this.orders.transitionStatus({
      orderId: id,
      toStatus: dto.status,
      actorId: user.id,
      reason: dto.reason,
      vendorScopeId: vendorId,
    });
  }
}
