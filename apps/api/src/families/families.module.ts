import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { AuthRequest } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { DatabaseService } from '../database/database.service';
import { AccessService } from '../common/access.service';
import { newProfile } from '../profiles/defaults';
class FamilyDto {
  @IsOptional()
  @IsString()
  id?: string;
  @IsString()
  @Length(1, 60)
  @Matches(/\S/)
  name!: string;
}
class CoupleDto extends FamilyDto {
  @IsString()
  familyId!: string;
}
class MemberDto {
  @IsString()
  @Length(1, 60)
  @Matches(/\S/)
  name!: string;
  @IsString()
  familyId!: string;
  @IsOptional()
  @IsString()
  coupleId?: string;
  @IsIn(['male', 'female'])
  sex!: 'male' | 'female';
}
class MembershipDto {
  @IsString()
  profileId!: string;
  @IsString()
  familyId!: string;
  @IsOptional()
  @IsString()
  coupleId?: string;
}
class DeleteFamilyDto {
  @IsString()
  id!: string;
  @IsString()
  @Length(1, 60)
  confirmationName!: string;
}
class RestoreFamilyDto {
  @IsString()
  id!: string;
}
@Injectable()
class FamiliesService {
  constructor(private readonly store: DatabaseService) {}
  async membership(
    familyId: string,
    coupleId?: string | null,
    profileId?: string,
  ) {
    if (!(await this.store.families()).some((f) => f.id === familyId))
      throw new BadRequestException('Family not found.');
    if (
      coupleId &&
      !(await this.store.couples()).some(
        (c) => c.id === coupleId && c.familyId === familyId,
      )
    )
      throw new BadRequestException('Choose a couple in this family.');
    if (
      coupleId &&
      (await this.store.profiles()).filter(
        (p) => p.id !== profileId && p.coupleId === coupleId,
      ).length >= 2
    )
      throw new BadRequestException('This couple already has two members.');
    return { familyId, coupleId: coupleId || null };
  }
  async member(data: MemberDto) {
    const p = newProfile({
      ...(await this.membership(data.familyId, data.coupleId)),
      id: randomUUID(),
      name: data.name.trim(),
      sex: data.sex,
    });
    await this.store.saveProfile(p);
    return p;
  }
}
@Controller()
class FamiliesController {
  constructor(
    private readonly store: DatabaseService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly families: FamiliesService,
  ) {}
  @Get('state')
  async state(
    @Req()
    req: AuthRequest,
  ) {
    return await this.store.snapshot(req.user);
  }
  @Get('export')
  async export(
    @Req()
    req: AuthRequest,
  ) {
    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      ...(await this.store.snapshot(req.user)),
    };
  }
  @Post('family')
  async family(
    @Req()
    req: AuthRequest,
    @Body()
    data: FamilyDto,
  ) {
    return this.store.transaction(async () => {
      this.auth.assertAdmin(req.user);
      if (data.id) await this.access.family(req.user, data.id);
      const id = data.id || randomUUID();
      await this.store.db.upsert('families', { id, name: data.name.trim() });
      return { id, name: data.name.trim() };
    });
  }
  @Get('family/deleted')
  async deleted(
    @Req()
    req: AuthRequest,
  ) {
    this.auth.assertAdmin(req.user);
    return await this.store.db
      .prepare(
        'SELECT id,name,archived_at AS deletedAt FROM families WHERE archived_at IS NOT NULL ORDER BY archived_at DESC',
      )
      .all();
  }
  @Post('family/delete')
  async delete(
    @Req()
    req: AuthRequest,
    @Body()
    data: DeleteFamilyDto,
  ) {
    return this.store.transaction(async () => {
      this.auth.assertAdmin(req.user);
      await this.access.family(req.user, data.id);
      const family = (await this.store.families()).find(
        (f) => f.id === data.id,
      )!;
      if (data.confirmationName !== family.name)
        throw new BadRequestException(
          'Type the exact current family name to confirm deletion.',
        );
      // Soft deletion hides all related data and denies family access without
      // discarding measurements, history, or approvals. Admin can restore it.
      await this.store.db
        .prepare('UPDATE families SET archived_at=? WHERE id=?')
        .run(new Date().toISOString(), data.id);
      return {
        ok: true,
        message: 'Family deleted. It can be restored from Deleted families.',
      };
    });
  }
  @Post('family/restore')
  async restore(
    @Req()
    req: AuthRequest,
    @Body()
    data: RestoreFamilyDto,
  ) {
    return this.store.transaction(async () => {
      this.auth.assertAdmin(req.user);
      if (
        !(await this.store.db
          .prepare(
            'SELECT id FROM families WHERE id=? AND archived_at IS NOT NULL',
          )
          .get(data.id))
      )
        throw new BadRequestException('Deleted family not found.');
      await this.store.db
        .prepare('UPDATE families SET archived_at=NULL WHERE id=?')
        .run(data.id);
      return { ok: true };
    });
  }
  @Post('couple')
  async couple(
    @Req()
    req: AuthRequest,
    @Body()
    data: CoupleDto,
  ) {
    return this.store.transaction(async () => {
      await this.access.family(req.user, data.familyId);
      if (
        data.id &&
        !(await this.store.couples()).some(
          (c) => c.id === data.id && c.familyId === data.familyId,
        )
      )
        throw new BadRequestException('Couple not found.');
      const id = data.id || randomUUID();
      await this.store.db.upsert(
        'couples',
        { id, family_id: data.familyId, name: data.name.trim() },
        ['id'],
        ['name'],
      );
      return { id, familyId: data.familyId, name: data.name.trim() };
    });
  }
  @Post('member')
  async member(
    @Req()
    req: AuthRequest,
    @Body()
    data: MemberDto,
  ) {
    return this.store.transaction(async () => {
      await this.access.family(req.user, data.familyId);
      return await this.families.member(data);
    });
  }
  @Post('membership')
  async membership(
    @Req()
    req: AuthRequest,
    @Body()
    data: MembershipDto,
  ) {
    return this.store.transaction(async () => {
      const p = await this.access.profile(req.user, data.profileId);
      await this.access.family(req.user, data.familyId);
      const updated = {
        ...p,
        ...(await this.families.membership(data.familyId, data.coupleId, p.id)),
      };
      await this.store.saveProfile(updated);
      return updated;
    });
  }
}
@Module({ controllers: [FamiliesController], providers: [FamiliesService] })
export class FamiliesModule {}
