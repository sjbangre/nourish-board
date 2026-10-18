import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.service';
import { AuthModule } from './auth/auth.module';
import { AccessModule } from './common/access.service';
import { AdminModule } from './admin/admin.module';
import { FamiliesModule } from './families/families.module';
import { ProfilesModule } from './profiles/profiles.module';
import { FoodsModule } from './foods/foods.module';
import { NutritionModule } from './nutrition/nutrition.module';
@Module({ imports: [DatabaseModule, AuthModule, AccessModule, AdminModule, FamiliesModule, ProfilesModule, FoodsModule, NutritionModule] })
export class AppModule {}
