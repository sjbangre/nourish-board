import { Body, Controller, Get, Module, Post, Query, Req } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccessService } from '../common/access.service';
import { DatabaseService } from '../database/database.service';
import type { AuthRequest } from '../auth/auth.module';
import { generatePlan, targets, workout } from './engine';
class PlanDto { @IsString() id!: string; @IsOptional() @IsInt() @Min(0) @Max(10000) variation?: number; }
@Controller()
class NutritionController {
  constructor(private readonly store: DatabaseService, private readonly access: AccessService) {}
  @Get('targets') targets(@Req() req: AuthRequest, @Query('id') id: string) { return targets(this.access.profile(req.user, id)); }
  @Get('workout') workout(@Req() req: AuthRequest, @Query('id') id: string) { return workout(this.access.profile(req.user, id)); }
  @Post('plan') generate(@Req() req: AuthRequest, @Body() data: PlanDto) {
    const p = this.access.profile(req.user, data.id);
    const result = { ...generatePlan(p, this.store.foods(), data.variation || 0), profileId: p.id, createdAt: new Date().toISOString() };
    this.store.db.prepare('INSERT INTO plans VALUES (?,?) ON CONFLICT(profile_id) DO UPDATE SET body=excluded.body').run(p.id, JSON.stringify(result)); return result;
  }
}
@Module({ controllers: [NutritionController] })
export class NutritionModule {}
