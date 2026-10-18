import { Controller, Get, Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.service';
import { AuthModule, Public } from './auth/auth.module';
import { AccessModule } from './common/access.service';
import { AdminModule } from './admin/admin.module';
import { FamiliesModule } from './families/families.module';
import { ProfilesModule } from './profiles/profiles.module';
import { FoodsModule } from './foods/foods.module';
import { NutritionModule } from './nutrition/nutrition.module';
@Controller()
class HealthController {
  @Public() @Get('health') health() {
    return { status: 'ok' };
  }
}
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AccessModule,
    AdminModule,
    FamiliesModule,
    ProfilesModule,
    FoodsModule,
    NutritionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
