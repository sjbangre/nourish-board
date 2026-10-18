import {
  Global,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  AppState,
  Couple,
  Family,
  Food,
  Plan,
  Profile,
  User,
  WeightLog,
} from '@nourish/contracts';
import { starterFoods } from '../foods/catalog';
import { newProfile } from '../profiles/defaults';
import { createDriver } from './driver';
import { azureSqlSchema, sqliteSchema } from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly db = createDriver();
  readonly ready = this.initialize();
  async onModuleInit() {
    await this.ready;
  }
  private async initialize() {
    if (
      this.db.kind === 'azure-sql' &&
      process.env.DATABASE_MIGRATIONS !== 'on'
    ) {
      if (
        !(await this.db
          .prepare('SELECT version FROM schema_migrations WHERE version=4')
          .get())
      )
        throw new Error(
          'Database schema is not initialized. Run the deployment migration first.',
        );
      return;
    }
    await this.db.transaction(async () => {
      await this.db.exec(
        this.db.kind === 'sqlite' ? sqliteSchema : azureSqlSchema,
      );
      if (
        this.db.kind === 'sqlite' &&
        !(await this.db.prepare('PRAGMA table_info(families)').all()).some(
          (column) => column.name === 'archived_at',
        )
      )
        await this.db.exec('ALTER TABLE families ADD COLUMN archived_at TEXT');
      const initialized = Boolean(
        await this.db
          .prepare('SELECT version FROM schema_migrations WHERE version=2')
          .get(),
      );
      for (const food of starterFoods)
        await this.db.upsert(
          'foods',
          { id: food.id, body: JSON.stringify(food) },
          ['id'],
          [],
        );
      // A new cloud database starts empty; local development retains the pilot.
      if (this.db.kind === 'sqlite' && !initialized) {
        if (!(await this.db.prepare('SELECT id FROM families').get())) {
          await this.db.upsert('families', {
            id: 'family-default',
            name: 'Our family',
          });
          await this.db.upsert('couples', {
            id: 'couple-default',
            family_id: 'family-default',
            name: 'Our couple',
          });
        }
        if (!(await this.db.prepare('SELECT id FROM profiles').get())) {
          for (const [id, name, sex] of [
            ['me', 'Me', 'male'],
            ['partner', 'My wife', 'female'],
          ] as const) {
            const p = newProfile({
              id,
              name,
              sex,
              familyId: 'family-default',
              coupleId: 'couple-default',
            });
            await this.db.upsert('profiles', { id, body: JSON.stringify(p) });
          }
        }
      }
      for (const row of await this.db
        .prepare('SELECT id,body FROM profiles')
        .all()) {
        const p = JSON.parse(row.body) as Profile;
        if (!p.familyId)
          await this.db.upsert('profiles', {
            id: p.id,
            body: JSON.stringify({
              ...p,
              familyId: 'family-default',
              coupleId: ['me', 'partner'].includes(p.id)
                ? 'couple-default'
                : null,
            }),
          });
      }
      for (const version of [2, 3, 4])
        await this.db.upsert(
          'schema_migrations',
          { version, applied_at: new Date().toISOString() },
          ['version'],
          [],
        );
    });
  }
  async transaction<T>(fn: () => T | Promise<T>) {
    await this.ready;
    return this.db.transaction(fn);
  }
  private async bodies<T>(table: 'profiles' | 'foods' | 'plans') {
    await this.ready;
    return (await this.db.prepare(`SELECT body FROM ${table}`).all()).map(
      (row) => JSON.parse(row.body) as T,
    );
  }
  profiles() {
    return this.bodies<Profile>('profiles');
  }
  foods() {
    return this.bodies<Food>('foods');
  }
  async families() {
    await this.ready;
    return this.db
      .prepare(
        'SELECT id,name FROM families WHERE archived_at IS NULL ORDER BY name,id',
      )
      .all<Family>();
  }
  async couples() {
    await this.ready;
    return this.db
      .prepare(
        'SELECT c.id,c.family_id AS familyId,c.name FROM couples c JOIN families f ON f.id=c.family_id WHERE f.archived_at IS NULL ORDER BY c.name,c.id',
      )
      .all<Couple>();
  }
  async profile(id: string) {
    await this.ready;
    const row = await this.db
      .prepare('SELECT body FROM profiles WHERE id=?')
      .get(id);
    return row ? (JSON.parse(row.body) as Profile) : undefined;
  }
  async saveProfile(p: Profile) {
    await this.ready;
    await this.db.upsert('profiles', { id: p.id, body: JSON.stringify(p) });
  }
  async user(id: string) {
    await this.ready;
    return this.db
      .prepare('SELECT id,email,name,role,status FROM users WHERE id=?')
      .get<User>(id);
  }
  async familyIds(user: User) {
    await this.ready;
    return user.role === 'admin'
      ? (await this.families()).map((f) => f.id)
      : (
          await this.db
            .prepare(
              'SELECT m.family_id FROM memberships m JOIN families f ON f.id=m.family_id WHERE m.user_id=? AND f.archived_at IS NULL',
            )
            .all(user.id)
        ).map((r) => String(r.family_id));
  }
  async snapshot(user: User): Promise<AppState> {
    return this.transaction(async () => {
      const allowed = new Set(await this.familyIds(user)),
        profiles = (await this.profiles()).filter((p) =>
          allowed.has(p.familyId),
        ),
        ids = new Set(profiles.map((p) => p.id));
      return {
        families: (await this.families()).filter((f) => allowed.has(f.id)),
        couples: (await this.couples()).filter((c) => allowed.has(c.familyId)),
        profiles,
        foods: await this.foods(),
        plans: (await this.bodies<Plan>('plans')).filter((p) =>
          ids.has(p.profileId),
        ),
        logs: (
          await this.db
            .prepare('SELECT * FROM logs ORDER BY day')
            .all<WeightLog>()
        ).filter((l) => ids.has(l.profile_id)),
      };
    });
  }
  async onModuleDestroy() {
    await this.ready.catch(() => undefined);
    await this.db.close();
  }
}
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
