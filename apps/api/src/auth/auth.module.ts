import { CanActivate, Controller, ExecutionContext, Get, Global, Injectable, Module, Post, Req, Res, SetMetadata } from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { User } from '@nourish/contracts';
import { ADMIN_EMAIL, AuthService } from './auth.service';
export type AuthRequest = Request & { user: User };
export const Public = () => SetMetadata('public', true);
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride('public', [context.getHandler(), context.getClass()])) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const user = this.auth.session(req);
    if (!user) throw new UnauthorizedException('Sign in with Google to continue.');
    if (user.status !== 'active') throw new ForbiddenException('Your access is waiting for administrator approval.');
    req.user = user; return true;
  }
}
@Controller('auth')
class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Get('me') me(@Req() req: Request) { return { user: this.auth.session(req), googleConfigured: this.auth.configured(), localDevelopment: this.auth.localMode(), adminEmail: ADMIN_EMAIL }; }
  @Public() @Get('google') begin(@Res() res: Response) { return this.auth.begin(res); }
  @Public() @Get('google/callback') async callback(@Req() req: Request, @Res() res: Response) {
    try { await this.auth.callback(req, res); } catch { res.clearCookie('nb_oauth', { path: '/' }); res.redirect(`${process.env.APP_URL || 'http://localhost:4318'}/?authError=sign-in-failed`); }
  }
  @Public() @Post('logout') logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return this.auth.logout(req, res); }
}
@Global()
@Module({ providers: [AuthService, { provide: APP_GUARD, useClass: SessionGuard }], controllers: [AuthController], exports: [AuthService] })
export class AuthModule {}
