export type Role = 'customer' | 'vendor_owner' | 'vendor_staff' | 'admin';

/**
 * The authenticated principal attached to every request by JwtAuthGuard.
 * `vendorIds` is the set of vendors this user may act on (owner + memberships);
 * empty for pure customers, ignored for admins (who bypass vendor scoping).
 */
export interface AuthUser {
  id: string;
  role: Role;
  vendorIds: string[];
}

/** JWT claims we sign/verify. Keep minimal — never put secrets here. */
export interface JwtClaims {
  sub: string; // user id
  role: Role;
  vendorIds: string[];
  iat?: number;
  exp?: number;
}

export function isAdmin(user: AuthUser): boolean {
  return user.role === 'admin';
}

export function isVendor(user: AuthUser): boolean {
  return user.role === 'vendor_owner' || user.role === 'vendor_staff';
}
