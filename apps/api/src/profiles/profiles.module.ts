import { Body, Controller, Module, Post, Req } from '@nestjs/common';
import { Allow, IsArray, IsString } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { AuthRequest } from '../auth/auth.module';
import { AccessService } from '../common/access.service';
import { DatabaseService } from '../database/database.service';
import { validateProfile } from '../nutrition/engine';
import type { Profile } from '@nourish/contracts';
class ProfileDto {
  @IsString() id!: string; @Allow() name!: unknown; @Allow() sex!: unknown; @Allow() age!: unknown;
  @Allow() height!: unknown; @Allow() weight!: unknown; @Allow() goalWeight!: unknown; @Allow() activity!: unknown;
  @Allow() deficit!: unknown; @Allow() proteinRate!: unknown; @Allow() wheyGrams!: unknown; @Allow() trainingDays!: unknown;
  @Allow() equipment!: unknown; @Allow() experience!: unknown; @Allow() favorites!: unknown; @Allow() excluded!: unknown; @Allow() needsReview!: unknown;
}
class PreferencesDto { @IsString() id!: string; @IsArray() @IsString({ each: true }) favorites!: string[]; }
class LogDto { @IsString() profileId!: string; @Allow() day!: unknown; @Allow() weight!: unknown; @Allow() note?: unknown; }
@Controller()
class ProfilesController {
  constructor(private readonly store: DatabaseService, private readonly access: AccessService) {}
  @Post('profile') save(@Req() req: AuthRequest, @Body() data: ProfileDto) {
    const previous = this.access.profile(req.user, data.id);
    const updated = { ...previous, ...validateProfile({ ...previous, ...data }) } as Profile;
    this.store.transaction(() => { this.store.saveProfile(updated); this.store.db.prepare('DELETE FROM plans WHERE profile_id=?').run(updated.id); });
    return updated;
  }
  @Post('preferences') preferences(@Req() req: AuthRequest, @Body() data: PreferencesDto) {
    const p = this.access.profile(req.user, data.id), foods = new Set(this.store.foods().map(f => f.id));
    if (data.favorites.length > 300) throw new Error('Too many preferred foods.');
    p.favorites = [...new Set(data.favorites)].filter(id => foods.has(id));
    this.store.transaction(() => { this.store.saveProfile(p); this.store.db.prepare('DELETE FROM plans WHERE profile_id=?').run(p.id); }); return p;
  }
  @Post('log') log(@Req() req: AuthRequest, @Body() data: LogDto) {
    this.access.profile(req.user, data.profileId);
    const weight = Number(data.weight), day = String(data.day);
    if (!Number.isFinite(weight) || weight < 35 || weight > 250) throw new Error('Weight must be between 35 and 250 kg.');
    const today = new Date(), todayLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day || day > todayLocal) throw new Error('Choose a valid date that is not in the future.');
    this.store.db.prepare('INSERT INTO logs VALUES (?,?,?,?,?) ON CONFLICT(profile_id,day) DO UPDATE SET weight=excluded.weight,note=excluded.note').run(randomUUID(), data.profileId, day, weight, String(data.note || '').slice(0, 300)); return { ok: true };
  }
}
@Module({ controllers: [ProfilesController] })
export class ProfilesModule {}
