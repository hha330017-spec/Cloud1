import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { VendorGuard } from './vendor.guard';

@Global()
@Module({
  imports: [
    JwtModule.register({
      // verification uses the secret passed per-call in JwtAuthGuard; signing
      // (login/refresh) configured where tokens are issued.
      global: false,
    }),
  ],
  providers: [JwtAuthGuard, RolesGuard, VendorGuard],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, VendorGuard],
})
export class AuthModule {}
