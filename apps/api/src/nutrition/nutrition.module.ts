import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccessService } from '../common/access.service';
import { DatabaseService } from '../database/database.service';
import type { AuthRequest } from '../auth/auth.module';
import { generatePlan, targets, workout } from './engine';
class PlanDto {
  @IsString()
  id!: string;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  variation?: number;
}
@Controller()
class NutritionController {
  constructor(
    private readonly store: DatabaseService,
    private readonly access: AccessService,
  ) {}
  @Get('targets')
  async targets(
    @Req()
    req: AuthRequest,
    @Query('id')
    id: string,
  ) {
    return targets(await this.access.profile(req.user, id));
  }
  @Get('workout')
  async workout(
    @Req()
    req: AuthRequest,
    @Query('id')
    id: string,
  ) {
    return workout(await this.access.profile(req.user, id));
  }
  @Post('plan')
  async generate(
    @Req()
    req: AuthRequest,
    @Body()
    data: PlanDto,
  ) {
    return this.store.transaction(async () => {
      const p = await this.access.profile(req.user, data.id);
      const result = {
        ...generatePlan(p, await this.store.foods(), data.variation || 0),
        profileId: p.id,
        createdAt: new Date().toISOString(),
      };
      await this.store.db.upsert(
        'plans',
        { profile_id: p.id, body: JSON.stringify(result) },
        ['profile_id'],
      );
      return result;
    });
  }
}
@Module({ controllers: [NutritionController] })
export class NutritionModule {}
