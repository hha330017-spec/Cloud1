import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';

/**
 * Injects the authenticated user resolved by JwtAuthGuard.
 * Usage: someHandler(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) {
      // Should never happen if JwtAuthGuard ran first; fail loud if it didn't.
      throw new Error('CurrentUser used without JwtAuthGuard');
    }
    return req.user;
  },
);
