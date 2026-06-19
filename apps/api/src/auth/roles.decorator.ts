import { SetMetadata } from '@nestjs/common';
import type { Role } from './auth-user';

export const ROLES_KEY = 'roles';

/** Restrict a route to specific roles. Used together with RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
