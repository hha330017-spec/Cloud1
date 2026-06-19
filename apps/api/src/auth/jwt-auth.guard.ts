import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthUser, JwtClaims } from './auth-user';

/**
 * Verifies the Bearer access token and attaches a normalised AuthUser to the
 * request. Everything downstream (RolesGuard, VendorGuard, scoped repos) trusts
 * req.user, so this is the single authentication chokepoint.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    req.user = {
      id: claims.sub,
      role: claims.role,
      vendorIds: claims.vendorIds ?? [],
    };
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim() || null;
  }
}
