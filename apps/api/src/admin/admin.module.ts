import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { AuthService, ADMIN_EMAIL } from '../auth/auth.service';
import type { AuthRequest } from '../auth/auth.module';
class InviteDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
  @IsString()
  familyId!: string;
}
class RevokeDto {
  @IsString()
  userId!: string;
}
class CancelInviteDto {
  @IsString()
  invitationId!: string;
}
@Controller('admin')
class AdminController {
  constructor(
    private readonly store: DatabaseService,
    private readonly auth: AuthService,
  ) {}
  @Get('access')
  async list(
    @Req()
    req: AuthRequest,
  ) {
    this.auth.assertAdmin(req.user);
    return {
      users: await this.store.db
        .prepare('SELECT id,email,name,role,status FROM users ORDER BY name')
        .all(),
      invitations: await this.store.db
        .prepare(
          'SELECT id,email,family_id AS familyId,created_at AS createdAt,status FROM invitations ORDER BY created_at DESC',
        )
        .all(),
      memberships: await this.store.db
        .prepare(
          'SELECT user_id AS userId,family_id AS familyId FROM memberships',
        )
        .all(),
    };
  }
  @Post('invitations')
  async approve(
    @Req()
    req: AuthRequest,
    @Body()
    data: InviteDto,
  ) {
    return this.store.transaction(async () => {
      this.auth.assertAdmin(req.user);
      if (!(await this.store.families()).some((f) => f.id === data.familyId))
        throw new BadRequestException('Choose an existing family.');
      const email = data.email.toLowerCase().trim();
      await this.store.db.upsert(
        'invitations',
        {
          id: randomUUID(),
          email,
          family_id: data.familyId,
          approved_by: req.user.email,
          created_at: new Date().toISOString(),
          status: 'approved',
        },
        ['email', 'family_id'],
        ['approved_by', 'created_at', 'status'],
      );
      const user = await this.store.db
        .prepare('SELECT id FROM users WHERE email=?')
        .get(email);
      if (user) {
        await this.store.db.upsert(
          'memberships',
          { user_id: user.id, family_id: data.familyId },
          ['user_id', 'family_id'],
          [],
        );
        await this.store.db
          .prepare("UPDATE users SET status='active' WHERE id=?")
          .run(user.id);
      }
      return {
        ok: true,
        message:
          'Invitation approved. This verified Google email can access the selected family.',
      };
    });
  }
  @Post('revoke')
  async revoke(
    @Req()
    req: AuthRequest,
    @Body()
    data: RevokeDto,
  ) {
    return this.store.transaction(async () => {
      this.auth.assertAdmin(req.user);
      const user = await this.store.user(data.userId);
      if (!user || user.email === ADMIN_EMAIL)
        throw new BadRequestException('The administrator cannot be revoked.');
      await this.store.db
        .prepare("UPDATE users SET status='revoked' WHERE id=?")
        .run(user.id);
      await this.store.db
        .prepare('DELETE FROM memberships WHERE user_id=?')
        .run(user.id);
      await this.store.db
        .prepare('DELETE FROM sessions WHERE user_id=?')
        .run(user.id);
      await this.store.db
        .prepare("UPDATE invitations SET status='revoked' WHERE email=?")
        .run(user.email);
      return { ok: true };
    });
  }
  @Post('cancel-invitation')
  async cancel(
    @Req()
    req: AuthRequest,
    @Body()
    data: CancelInviteDto,
  ) {
    return this.store.transaction(async () => {
      this.auth.assertAdmin(req.user);
      const invitation = await this.store.db
        .prepare('SELECT email,family_id FROM invitations WHERE id=?')
        .get(data.invitationId);
      if (!invitation || invitation.email === ADMIN_EMAIL)
        throw new BadRequestException('Invitation cannot be cancelled.');
      await this.store.db
        .prepare("UPDATE invitations SET status='revoked' WHERE id=?")
        .run(data.invitationId);
      const user = await this.store.db
        .prepare('SELECT id FROM users WHERE email=?')
        .get(invitation.email);
      if (user) {
        await this.store.db
          .prepare('DELETE FROM memberships WHERE user_id=? AND family_id=?')
          .run(user.id, invitation.family_id);
        if (
          !(await this.store.db
            .prepare('SELECT family_id FROM memberships WHERE user_id=?')
            .get(user.id))
        )
          await this.store.db
            .prepare("UPDATE users SET status='pending' WHERE id=?")
            .run(user.id);
      }
      return { ok: true };
    });
  }
}
@Module({ controllers: [AdminController] })
export class AdminModule {}
