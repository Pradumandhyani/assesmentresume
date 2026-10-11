import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { AuthSecurity } from './auth.security';
import { PasswordService } from './password.service';
@Module({ controllers: [AuthController], providers: [AuthService, AuthRepository, AuthSecurity, PasswordService], exports: [AuthService] })
export class AuthModule {}
