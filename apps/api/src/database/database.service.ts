import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AppState, Couple, Family, Food, Plan, Profile, User, WeightLog } from '@nourish/contracts';
import { starterFoods } from '../foods/catalog';
import { defaultPreferences } from '../nutrition/engine';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync;
  constructor() {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'nourish.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS foods(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(profile_id TEXT PRIMARY KEY REFERENCES profiles(id),body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logs(id TEXT PRIMARY KEY,profile_id TEXT REFERENCES profiles(id),day TEXT NOT NULL,weight REAL NOT NULL,note TEXT NOT NULL,UNIQUE(profile_id,day));
      CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS couples(id TEXT PRIMARY KEY,family_id TEXT NOT NULL REFERENCES families(id),name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,google_id TEXT UNIQUE,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id),family_id TEXT REFERENCES families(id),PRIMARY KEY(user_id,family_id));
      CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,email TEXT NOT NULL,family_id TEXT REFERENCES families(id),approved_by TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(email,family_id));
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_attempts(state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);`);
    if (!this.db.prepare('PRAGMA table_info(families)').all().some(column => column.name === 'archived_at')) this.db.exec('ALTER TABLE families ADD COLUMN archived_at TEXT');
    this.transaction(() => {
      const initialized = Boolean(this.db.prepare('SELECT version FROM schema_migrations WHERE version=2').get());
      const insert = this.db.prepare('INSERT OR IGNORE INTO foods VALUES (?,?)');
      for (const food of starterFoods) insert.run(food.id, JSON.stringify(food));
      if (!initialized && !this.db.prepare('SELECT id FROM families LIMIT 1').get()) {
        this.db.prepare('INSERT INTO families(id,name) VALUES (?,?)').run('family-default', 'Our family');
        this.db.prepare('INSERT INTO couples VALUES (?,?,?)').run('couple-default', 'family-default', 'Our couple');
      }
      if (!initialized && !this.db.prepare('SELECT id FROM profiles LIMIT 1').get()) {
        for (const [id, name, sex] of [['me', 'Me', 'male'], ['partner', 'My wife', 'female']] as const) this.saveProfile({ id, name, sex, familyId: 'family-default', coupleId: 'couple-default', configured: false, age: '', height: '', weight: '', goalWeight: '', activity: 1.375, deficit: 15, proteinRate: 1.6, wheyGrams: 0, trainingDays: 3, equipment: 'gym', experience: 'beginner', favorites: defaultPreferences, excluded: [], needsReview: false });
      }
      for (const p of this.profiles()) if (!p.familyId) this.saveProfile({ ...p, familyId: 'family-default', coupleId: ['me', 'partner'].includes(p.id) ? 'couple-default' : null });
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?,?)').run(2, new Date().toISOString());
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?,?)').run(3, new Date().toISOString());
    });
  }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  private bodies<T>(table: 'profiles' | 'foods' | 'plans'): T[] { return this.db.prepare(`SELECT body FROM ${table}`).all().map(row => JSON.parse(String(row.body)) as T); }
  profiles() { return this.bodies<Profile>('profiles'); }
  foods() { return this.bodies<Food>('foods'); }
  families() { return this.db.prepare('SELECT id,name FROM families WHERE archived_at IS NULL ORDER BY rowid').all() as unknown as Family[]; }
  couples() { return this.db.prepare('SELECT c.id,c.family_id AS familyId,c.name FROM couples c JOIN families f ON f.id=c.family_id WHERE f.archived_at IS NULL ORDER BY c.rowid').all() as unknown as Couple[]; }
  profile(id: string) { return this.profiles().find(p => p.id === id); }
  saveProfile(p: Profile) { this.db.prepare('INSERT INTO profiles VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(p.id, JSON.stringify(p)); }
  user(id: string) { return this.db.prepare('SELECT id,email,name,role,status FROM users WHERE id=?').get(id) as unknown as User | undefined; }
  familyIds(user: User) { return user.role === 'admin' ? this.families().map(f => f.id) : (this.db.prepare('SELECT m.family_id FROM memberships m JOIN families f ON f.id=m.family_id WHERE m.user_id=? AND f.archived_at IS NULL').all(user.id)).map(r => String(r.family_id)); }
  snapshot(user: User): AppState {
    const allowed = new Set(this.familyIds(user)), profiles = this.profiles().filter(p => allowed.has(p.familyId)), ids = new Set(profiles.map(p => p.id));
    return { families: this.families().filter(f => allowed.has(f.id)), couples: this.couples().filter(c => allowed.has(c.familyId)), profiles, foods: this.foods(), plans: this.bodies<Plan>('plans').filter(p => ids.has(p.profileId)), logs: (this.db.prepare('SELECT * FROM logs ORDER BY day').all() as unknown as WeightLog[]).filter(l => ids.has(l.profile_id)) };
  }
  onModuleDestroy() { this.db.close(); }
}
@Global()
@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
