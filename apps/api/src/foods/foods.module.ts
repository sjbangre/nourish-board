import { Allow, IsOptional, IsString } from 'class-validator';
import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createFoodLookup } from './lookup';
import { DatabaseService } from '../database/database.service';
import { validateFood } from '../nutrition/engine';
import type { AuthRequest } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
class FoodDto {
  @IsOptional()
  @IsString()
  id?: string;
  @Allow()
  name!: unknown;
  @Allow()
  category!: unknown;
  @Allow()
  kcal!: unknown;
  @Allow()
  protein!: unknown;
  @Allow()
  carbs!: unknown;
  @Allow()
  fat!: unknown;
  @Allow()
  fiber!: unknown;
  @Allow()
  maxGrams!: unknown;
  @Allow()
  source!: unknown;
  @Allow()
  sourceUrl?: unknown;
  @Allow()
  provider?: unknown;
  @Allow()
  license?: unknown;
  @Allow()
  externalId?: unknown;
}
@Injectable()
class FoodLookupService {
  readonly search = createFoodLookup();
}
@Controller()
class FoodsController {
  constructor(
    private readonly store: DatabaseService,
    private readonly auth: AuthService,
    private readonly lookup: FoodLookupService,
  ) {}
  @Get('food-search')
  search(
    @Query('q')
    q: string,
  ) {
    return this.lookup.search(q);
  }
  @Post('food')
  async save(
    @Req()
    req: AuthRequest,
    @Body()
    data: FoodDto,
  ) {
    return this.store.transaction(async () => {
      // Nutrition catalog is shared. Only admin may change global values used by other families.
      this.auth.assertAdmin(req.user);
      if (data.id && !(await this.store.foods()).some((f) => f.id === data.id))
        throw new Error('Food not found.');
      const food = { ...validateFood(data), id: data.id || randomUUID() };
      await this.store.db.upsert('foods', {
        id: food.id,
        body: JSON.stringify(food),
      });
      await this.store.db.prepare('DELETE FROM plans').run();
      return food;
    });
  }
}
@Module({ controllers: [FoodsController], providers: [FoodLookupService] })
export class FoodsModule {}
