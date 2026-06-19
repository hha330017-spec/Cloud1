import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';
import { isAdmin, isVendor } from './auth-user';

/**
 * Resolves and pins the "active vendor" for vendor-scoped routes, then exposes
 * it as req.vendorScopeId for controllers/services.
 *
 * Resolution rules:
 *   - admin            -> may act on any vendor; the vendor id MUST be provided
 *                         explicitly (route param :vendorId or header) — admins
 *                         never get an implicit scope, preventing accidental
 *                         cross-vendor writes.
 *   - vendor_*         -> the active vendor must be one of user.vendorIds. If a
 *                         :vendorId param is present it must match a membership;
 *                         otherwise we default to their sole vendor.
 *   - everyone else    -> rejected.
 *
 * This guard is the FIRST isolation layer. The scoped repository (which always
 * appends `WHERE vendor_id = :scope`) is the SECOND, defence-in-depth layer.
 */
@Injectable()
export class VendorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; vendorScopeId?: string }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const requested =
      (req.params?.vendorId as string | undefined) ??
      (req.headers['x-vendor-id'] as string | undefined);

    if (isAdmin(user)) {
      if (!requested) {
        throw new ForbiddenException('Admin must specify a vendor scope (vendorId)');
      }
      req.vendorScopeId = requested;
      return true;
    }

    if (!isVendor(user) || user.vendorIds.length === 0) {
      throw new ForbiddenException('Not a vendor account');
    }

    if (requested) {
      if (!user.vendorIds.includes(requested)) {
        // Asking for a vendor they don't belong to -> hard deny.
        throw new ForbiddenException('You do not have access to this vendor');
      }
      req.vendorScopeId = requested;
    } else {
      // No explicit vendor -> default to their (single) vendor.
      req.vendorScopeId = user.vendorIds[0]!;
    }
    return true;
  }
}

/** Param decorator to read the resolved scope in handlers. */
export const VendorScopeId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { vendorScopeId?: string }>();
    if (!req.vendorScopeId) throw new ForbiddenException('Vendor scope unresolved');
    return req.vendorScopeId;
  },
);
