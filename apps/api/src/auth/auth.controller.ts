import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import {
  type Challenge,
  challengeSchema,
  ErrorCode,
  forgotPasswordBodySchema,
  loginBodySchema,
  type LoginBody,
  type Me,
  meSchema,
  okSchema,
  registerBodySchema,
  type RegisterBody,
  resendCodeBodySchema,
  resetPasswordBodySchema,
  type ResetPasswordBody,
  verifyCodeBodySchema,
  type VerifyCodeBody,
} from '@frontdesk/shared';
import type { Request, Response } from 'express';
import { Auth, LoggedIn, Public, type UserAuth } from '../common/auth.js';
import { clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from '../common/cookies.js';
import { sha256 } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AuthService } from './auth.service.js';
import { SessionsService } from './sessions.service.js';

const OK = { ok: true } as const;

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('register')
  @Returns(challengeSchema, 201)
  async register(@Body({ schema: registerBodySchema }) body: RegisterBody, @Req() req: Request): Promise<Challenge> {
    // A public demo runs on the owner's AI key: nobody else gets an account there.
    if (this.config.DEMO_MODE) throw new AppError(403, ErrorCode.DEMO_MODE, 'This is a public demo, so sign-up is switched off.');
    await this.limiter.hit(`register:ip:${req.ip}`, 5, 60 * 60);
    return this.auth.register(body);
  }

  @Public()
  @Post('login')
  @Returns(challengeSchema)
  async login(@Body({ schema: loginBodySchema }) body: LoginBody, @Req() req: Request): Promise<Challenge> {
    await this.limiter.hit(`login:ip:${req.ip}`, 20, 60);
    await this.limiter.hit(`login:email:${sha256(body.email)}`, 5, 60);
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('verify-code')
  @Returns(meSchema)
  async verifyCode(
    @Body({ schema: verifyCodeBodySchema }) body: VerifyCodeBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Me> {
    await this.limiter.hit(`code:ip:${req.ip}`, 30, 60);
    const tokens = await this.auth.verifyCode(body.challengeId, body.code);
    setAuthCookies(res, tokens.access, tokens.refresh);
    return this.auth.me(tokens.userId);
  }

  @Public()
  @Post('resend-code')
  @Returns(challengeSchema)
  async resendCode(
    @Body({ schema: resendCodeBodySchema }) body: { challengeId: string },
    @Req() req: Request,
  ): Promise<Challenge> {
    await this.limiter.hit(`resend:ip:${req.ip}`, 10, 15 * 60);
    const pending = await this.auth.pendingLogin(body.challengeId);
    if (!pending) throw new AppError(400, ErrorCode.CODE_EXPIRED, 'This login has expired. Please log in again.');
    await this.limiter.hit(`resend:user:${pending.userId}`, 3, 15 * 60);
    return this.auth.challenge(pending.userId, pending.email);
  }

  @Public()
  @Post('refresh')
  @Returns(okSchema)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limiter.hit(`refresh:ip:${req.ip}`, 60, 60);
    try {
      const tokens = await this.sessions.rotate(readCookie(req, REFRESH_COOKIE));
      setAuthCookies(res, tokens.access, tokens.refresh);
      return OK;
    } catch (err) {
      clearAuthCookies(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @Returns(okSchema)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revokeFamilyOf(readCookie(req, REFRESH_COOKIE));
    clearAuthCookies(res);
    return OK;
  }

  @Public()
  @Post('forgot-password')
  @Returns(okSchema)
  async forgotPassword(@Body({ schema: forgotPasswordBodySchema }) body: { email: string }, @Req() req: Request) {
    await this.limiter.hit(`forgot:ip:${req.ip}`, 5, 15 * 60);
    await this.limiter.hit(`forgot:email:${sha256(body.email)}`, 3, 15 * 60);
    await this.auth.forgotPassword(body.email);
    return OK;
  }

  @Public()
  @Post('reset-password')
  @Returns(okSchema)
  async resetPassword(@Body({ schema: resetPasswordBodySchema }) body: ResetPasswordBody, @Req() req: Request) {
    await this.limiter.hit(`reset:ip:${req.ip}`, 10, 15 * 60);
    await this.auth.resetPassword(body.token, body.password);
    return OK;
  }

  @LoggedIn()
  @Get('me')
  @Returns(meSchema)
  me(@Auth() auth: UserAuth): Promise<Me> {
    return this.auth.me(auth.userId);
  }
}
