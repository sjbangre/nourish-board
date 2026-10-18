import { Body, Controller, Module, Post, Req } from '@nestjs/common';
import { Allow, IsArray, IsString } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { AuthRequest } from '../auth/auth.module';
import { AccessService } from '../common/access.service';
import { DatabaseService } from '../database/database.service';
import { validateProfile } from '../nutrition/engine';
import type { Profile } from '@nourish/contracts';
class ProfileDto {
  @IsString()
  id!: string;
  @Allow()
  name!: unknown;
  @Allow()
  sex!: unknown;
  @Allow()
  age!: unknown;
  @Allow()
  height!: unknown;
  @Allow()
  weight!: unknown;
  @Allow()
  goalWeight!: unknown;
  @Allow()
  activity!: unknown;
  @Allow()
  deficit!: unknown;
  @Allow()
  proteinRate!: unknown;
  @Allow()
  wheyGrams!: unknown;
  @Allow()
  trainingDays!: unknown;
  @Allow()
  equipment!: unknown;
  @Allow()
  experience!: unknown;
  @Allow()
  favorites!: unknown;
  @Allow()
  excluded!: unknown;
  @Allow()
  needsReview!: unknown;
}
class PreferencesDto {
  @IsString()
  id!: string;
  @IsArray()
  @IsString({ each: true })
  favorites!: string[];
}
class LogDto {
  @IsString()
  profileId!: string;
  @Allow()
  day!: unknown;
  @Allow()
  weight!: unknown;
  @Allow()
  note?: unknown;
}
@Controller()
class ProfilesController {
  constructor(
    private readonly store: DatabaseService,
    private readonly access: AccessService,
  ) {}
  @Post('profile')
  async save(
    @Req()
    req: AuthRequest,
    @Body()
    data: ProfileDto,
  ) {
    return this.store.transaction(async () => {
      const previous = await this.access.profile(req.user, data.id);
      const updated = {
        ...previous,
        ...validateProfile({ ...previous, ...data }),
      } as Profile;
      await this.store.saveProfile(updated);
      await this.store.db
        .prepare('DELETE FROM plans WHERE profile_id=?')
        .run(updated.id);
      return updated;
    });
  }
  @Post('preferences')
  async preferences(
    @Req()
    req: AuthRequest,
    @Body()
    data: PreferencesDto,
  ) {
    return this.store.transaction(async () => {
      const p = await this.access.profile(req.user, data.id),
        foods = new Set((await this.store.foods()).map((f) => f.id));
      if (data.favorites.length > 300)
        throw new Error('Too many preferred foods.');
      p.favorites = [...new Set(data.favorites)].filter((id) => foods.has(id));
      await this.store.saveProfile(p);
      await this.store.db
        .prepare('DELETE FROM plans WHERE profile_id=?')
        .run(p.id);
      return p;
    });
  }
  @Post('log')
  async log(
    @Req()
    req: AuthRequest,
    @Body()
    data: LogDto,
  ) {
    return this.store.transaction(async () => {
      await this.access.profile(req.user, data.profileId);
      const weight = Number(data.weight),
        day = String(data.day);
      if (!Number.isFinite(weight) || weight < 35 || weight > 250)
        throw new Error('Weight must be between 35 and 250 kg.');
      const today = new Date(),
        todayLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day ||
        day > todayLocal
      )
        throw new Error('Choose a valid date that is not in the future.');
      await this.store.db.upsert(
        'logs',
        {
          id: randomUUID(),
          profile_id: data.profileId,
          day,
          weight,
          note: String(data.note || '').slice(0, 300),
        },
        ['profile_id', 'day'],
        ['weight', 'note'],
      );
      return { ok: true };
    });
  }
}
@Module({ controllers: [ProfilesController] })
export class ProfilesModule {}
