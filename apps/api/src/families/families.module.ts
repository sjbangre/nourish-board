import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Profile } from '@nourish/contracts';
import type { AuthRequest } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { DatabaseService } from '../database/database.service';
import { AccessService } from '../common/access.service';
import { defaultPreferences } from '../nutrition/engine';
class FamilyDto { @IsOptional() @IsString() id?: string; @IsString() @Length(1, 60) @Matches(/\S/) name!: string; }
class CoupleDto extends FamilyDto { @IsString() familyId!: string; }
class MemberDto { @IsString() @Length(1, 60) @Matches(/\S/) name!: string; @IsString() familyId!: string; @IsOptional() @IsString() coupleId?: string; @IsIn(['male', 'female']) sex!: 'male' | 'female'; }
class MembershipDto { @IsString() profileId!: string; @IsString() familyId!: string; @IsOptional() @IsString() coupleId?: string; }
class DeleteFamilyDto { @IsString() id!: string; @IsString() @Length(1, 60) confirmationName!: string; }
class RestoreFamilyDto { @IsString() id!: string; }
@Injectable()
class FamiliesService {
  constructor(private readonly store: DatabaseService) {}
  membership(familyId: string, coupleId?: string | null, profileId?: string) {
    if (!this.store.families().some(f => f.id === familyId)) throw new BadRequestException('Family not found.');
    if (coupleId && !this.store.couples().some(c => c.id === coupleId && c.familyId === familyId)) throw new BadRequestException('Choose a couple in this family.');
    if (coupleId && this.store.profiles().filter(p => p.id !== profileId && p.coupleId === coupleId).length >= 2) throw new BadRequestException('This couple already has two members.');
    return { familyId, coupleId: coupleId || null };
  }
  member(data: MemberDto) {
    const p: Profile = { ...this.membership(data.familyId, data.coupleId), id: randomUUID(), name: data.name.trim(), sex: data.sex, configured: false, age: '', height: '', weight: '', goalWeight: '', activity: 1.375, deficit: 15, proteinRate: 1.6, wheyGrams: 0, trainingDays: 3, equipment: 'gym', experience: 'beginner', favorites: [...defaultPreferences], excluded: [], needsReview: false };
    this.store.saveProfile(p); return p;
  }
}
@Controller()
class FamiliesController {
  constructor(private readonly store: DatabaseService, private readonly access: AccessService, private readonly auth: AuthService, private readonly families: FamiliesService) {}
  @Get('state') state(@Req() req: AuthRequest) { return this.store.snapshot(req.user); }
  @Get('export') export(@Req() req: AuthRequest) { return { version: 3, exportedAt: new Date().toISOString(), ...this.store.snapshot(req.user) }; }
  @Post('family') family(@Req() req: AuthRequest, @Body() data: FamilyDto) {
    this.auth.assertAdmin(req.user);
    if (data.id) this.access.family(req.user, data.id);
    const id = data.id || randomUUID(); this.store.db.prepare('INSERT INTO families(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id, data.name.trim()); return { id, name: data.name.trim() };
  }
  @Get('family/deleted') deleted(@Req() req: AuthRequest) {
    this.auth.assertAdmin(req.user);
    return this.store.db.prepare('SELECT id,name,archived_at AS deletedAt FROM families WHERE archived_at IS NOT NULL ORDER BY archived_at DESC').all();
  }
  @Post('family/delete') delete(@Req() req: AuthRequest, @Body() data: DeleteFamilyDto) {
    this.auth.assertAdmin(req.user); this.access.family(req.user, data.id);
    const family = this.store.families().find(f => f.id === data.id)!;
    if (data.confirmationName !== family.name) throw new BadRequestException('Type the exact current family name to confirm deletion.');
    // Soft deletion hides all related data and denies family access without
    // discarding measurements, history, or approvals. Admin can restore it.
    this.store.db.prepare('UPDATE families SET archived_at=? WHERE id=?').run(new Date().toISOString(), data.id);
    return { ok: true, message: 'Family deleted. It can be restored from Deleted families.' };
  }
  @Post('family/restore') restore(@Req() req: AuthRequest, @Body() data: RestoreFamilyDto) {
    this.auth.assertAdmin(req.user);
    if (!this.store.db.prepare('SELECT id FROM families WHERE id=? AND archived_at IS NOT NULL').get(data.id)) throw new BadRequestException('Deleted family not found.');
    this.store.db.prepare('UPDATE families SET archived_at=NULL WHERE id=?').run(data.id);
    return { ok: true };
  }
  @Post('couple') couple(@Req() req: AuthRequest, @Body() data: CoupleDto) {
    this.access.family(req.user, data.familyId);
    if (data.id && !this.store.couples().some(c => c.id === data.id && c.familyId === data.familyId)) throw new BadRequestException('Couple not found.');
    const id = data.id || randomUUID(); this.store.db.prepare('INSERT INTO couples VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id, data.familyId, data.name.trim()); return { id, familyId: data.familyId, name: data.name.trim() };
  }
  @Post('member') member(@Req() req: AuthRequest, @Body() data: MemberDto) { this.access.family(req.user, data.familyId); return this.families.member(data); }
  @Post('membership') membership(@Req() req: AuthRequest, @Body() data: MembershipDto) {
    const p = this.access.profile(req.user, data.profileId); this.access.family(req.user, data.familyId);
    const updated = { ...p, ...this.families.membership(data.familyId, data.coupleId, p.id) }; this.store.saveProfile(updated); return updated;
  }
}
@Module({ controllers: [FamiliesController], providers: [FamiliesService] })
export class FamiliesModule {}
