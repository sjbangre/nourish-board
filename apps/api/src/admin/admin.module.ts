import { Body, Controller, Get, Module, Post, Req, BadRequestException } from '@nestjs/common';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { AuthService, ADMIN_EMAIL } from '../auth/auth.service';
import type { AuthRequest } from '../auth/auth.module';
class InviteDto { @IsEmail() @MaxLength(254) email!: string; @IsString() familyId!: string; }
class RevokeDto { @IsString() userId!: string; }
class CancelInviteDto { @IsString() invitationId!: string; }
@Controller('admin')
class AdminController {
  constructor(private readonly store: DatabaseService, private readonly auth: AuthService) {}
  @Get('access') list(@Req() req: AuthRequest) {
    this.auth.assertAdmin(req.user);
    return { users: this.store.db.prepare('SELECT id,email,name,role,status FROM users ORDER BY name').all(), invitations: this.store.db.prepare('SELECT id,email,family_id AS familyId,created_at AS createdAt,status FROM invitations ORDER BY created_at DESC').all(), memberships: this.store.db.prepare('SELECT user_id AS userId,family_id AS familyId FROM memberships').all() };
  }
  @Post('invitations') approve(@Req() req: AuthRequest, @Body() data: InviteDto) {
    this.auth.assertAdmin(req.user);
    if (!this.store.families().some(f => f.id === data.familyId)) throw new BadRequestException('Choose an existing family.');
    const email = data.email.toLowerCase().trim();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO invitations VALUES (?,?,?,?,?,?) ON CONFLICT(email,family_id) DO UPDATE SET approved_by=excluded.approved_by,created_at=excluded.created_at,status='approved'`).run(randomUUID(), email, data.familyId, req.user.email, new Date().toISOString(), 'approved');
      const user = this.store.db.prepare('SELECT id FROM users WHERE email=?').get(email);
      if (user) {
        this.store.db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?)').run(user.id, data.familyId);
        this.store.db.prepare("UPDATE users SET status='active' WHERE id=?").run(user.id);
      }
    });
    return { ok: true, message: 'Invitation approved. This verified Google email can access the selected family.' };
  }
  @Post('revoke') revoke(@Req() req: AuthRequest, @Body() data: RevokeDto) {
    this.auth.assertAdmin(req.user);
    const user = this.store.user(data.userId);
    if (!user || user.email === ADMIN_EMAIL) throw new BadRequestException('The administrator cannot be revoked.');
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE users SET status='revoked' WHERE id=?").run(user.id);
      this.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(user.id);
      this.store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      this.store.db.prepare("UPDATE invitations SET status='revoked' WHERE email=?").run(user.email);
    });
    return { ok: true };
  }
  @Post('cancel-invitation') cancel(@Req() req: AuthRequest, @Body() data: CancelInviteDto) {
    this.auth.assertAdmin(req.user);
    const invitation = this.store.db.prepare('SELECT email,family_id FROM invitations WHERE id=?').get(data.invitationId);
    if (!invitation || invitation.email === ADMIN_EMAIL) throw new BadRequestException('Invitation cannot be cancelled.');
    this.store.transaction(() => {
      this.store.db.prepare("UPDATE invitations SET status='revoked' WHERE id=?").run(data.invitationId);
      const user = this.store.db.prepare('SELECT id FROM users WHERE email=?').get(invitation.email);
      if (user) {
        this.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND family_id=?').run(user.id, invitation.family_id);
        if (!this.store.db.prepare('SELECT family_id FROM memberships WHERE user_id=? LIMIT 1').get(user.id)) this.store.db.prepare("UPDATE users SET status='pending' WHERE id=?").run(user.id);
      }
    });
    return { ok: true };
  }
}
@Module({ controllers: [AdminController] })
export class AdminModule {}
