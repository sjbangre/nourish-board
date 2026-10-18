import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../main';
import { DatabaseService } from '../database/database.service';
import { AuthService, ADMIN_EMAIL, canAdmin } from '../auth/auth.service';
import type { User } from '@nourish/contracts';
const profileInput = { id: 'me', name: 'API test', sex: 'male', age: 35, height: 175, weight: 80, goalWeight: 72, activity: 1.55, deficit: 15, proteinRate: 1.6, wheyGrams: 0, trainingDays: 3, equipment: 'gym', experience: 'beginner' };
test('Nest API enforces admin approval and family isolation, persists plans, and validates inputs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nourish-nest-'));
  process.env.DATA_DIR = dir; process.env.NODE_ENV = 'test'; process.env.LOCAL_DEV_AUTH = 'false';
  const app = await createApp(); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(DatabaseService).db;
  const admin: User = { id: 'admin-test', email: ADMIN_EMAIL, name: 'Admin', role: 'admin', status: 'active' };
  const member: User = { id: 'member-test', email: 'relative@example.com', name: 'Relative', role: 'member', status: 'pending' };
  const other: User = { id: 'other-test', email: 'other@example.com', name: 'Other', role: 'member', status: 'active' };
  function session(user: User) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id, user.id, user.email, user.name, user.role, user.status);
    const token = `test-session-${user.id}`;
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), user.id, Date.now() + 3600_000);
    return `nb_session=${token}`;
  }
  const adminCookie = session(admin), memberCookie = session(member), otherCookie = session(other);
  const get = (url: string, cookie?: string) => fetch(`${base}/api/${url}`, { headers: cookie ? { Cookie: cookie } : {} });
  const post = (url: string, value: unknown, cookie = adminCookie, headers = {}) => fetch(`${base}/api/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: JSON.stringify(value) });
  try {
    assert.equal((await get('state')).status, 401);
    assert.equal((await get('auth/me', memberCookie)).status, 200);
    assert.equal((await get('state', memberCookie)).status, 403);
    assert.equal((await get('admin/access', otherCookie)).status, 403);
    assert.equal((await post('admin/invitations', { email: member.email, familyId: 'family-default' }, otherCookie)).status, 403);
    assert.equal((await post('admin/invitations', { email: member.email, familyId: 'family-default' })).status, 201);
    const invite = db.prepare('SELECT id FROM invitations WHERE email=?').get(member.email)!;
    assert.equal((await post('admin/cancel-invitation', { invitationId: invite.id }, otherCookie)).status, 403);
    assert.equal((await post('admin/cancel-invitation', { invitationId: invite.id })).status, 201);
    assert.equal((await get('state', memberCookie)).status, 403);
    assert.equal((await post('admin/invitations', { email: member.email, familyId: 'family-default' })).status, 201);
    const allowed = await (await get('state', memberCookie)).json();
    assert.equal(allowed.families.length, 1);
    assert.equal(allowed.profiles.length, 2);
    const secondFamily = await (await post('family', { name: 'Private second family' })).json();
    const relative = await (await post('member', { name: 'Second family person', sex: 'female', familyId: secondFamily.id })).json();
    assert.ok(relative.id);
    const filtered = await (await get('state', memberCookie)).json();
    assert.equal(filtered.families.length, 1);
    assert.ok(!filtered.profiles.some((p: { id: string }) => p.id === relative.id));
    assert.equal((await get(`workout?id=${relative.id}`, memberCookie)).status, 403);
    assert.equal((await post('profile', { ...profileInput, id: relative.id }, memberCookie)).status, 403);
    assert.equal((await post('membership', { profileId: 'me', familyId: secondFamily.id }, memberCookie)).status, 403);
    assert.equal((await post('family', { name: 'Should not create' }, memberCookie)).status, 403);
    assert.equal((await post('profile', profileInput, memberCookie)).status, 201);
    const generated = await post('plan', { id: 'me' }, memberCookie); assert.equal(generated.status, 201); assert.ok((await generated.json()).items.length > 2);
    assert.equal((await post('log', { profileId: 'me', day: '2026-01-01', weight: 79.5 }, memberCookie)).status, 201);
    assert.equal((await post('log', { profileId: 'me', day: '2026-02-31', weight: 79 }, memberCookie)).status, 400);
    assert.equal((await post('member', { name: 'Third', sex: 'male', familyId: 'family-default', coupleId: 'couple-default' })).status, 400);
    assert.equal((await post('member', { name: 'Individual', sex: 'female', familyId: 'family-default' })).status, 201);
    assert.equal((await post('family', { name: '  ' })).status, 400);
    assert.equal((await post('profile', { ...profileInput, role: 'admin' }, memberCookie)).status, 400);
    assert.equal((await post('profile', profileInput, memberCookie, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('food', { name: 'Bad edit' }, memberCookie)).status, 403);
    assert.equal((await (await get('export', memberCookie)).json()).families.length, 1);
    assert.equal((await post('admin/revoke', { userId: admin.id })).status, 400);
    assert.equal((await post('admin/revoke', { userId: member.id })).status, 201);
    assert.equal((await get('state', memberCookie)).status, 401);
    assert.equal(db.prepare("SELECT count(*) AS n FROM invitations WHERE email=? AND status='approved'").get(member.email)?.n, 0);
    assert.equal(canAdmin({ ...member, role: 'admin', status: 'active' }), false);
    // Logout removes the server-side session, not just the browser cookie.
    assert.equal((await post('auth/logout', {}, otherCookie)).status, 201);
    assert.equal((await get('state', otherCookie)).status, 401);
    await app.close();
    const restarted = await createApp(); await restarted.init();
    const persisted = restarted.get(DatabaseService);
    assert.equal(persisted.profiles().find(p => p.id === 'me')?.weight, 80);
    assert.equal(persisted.snapshot(admin).plans.length, 1);
    assert.equal(persisted.snapshot(admin).logs.length, 1);
    await restarted.close();
  } finally { try { await app.close(); } catch {} await rm(dir, { recursive: true, force: true }); }
});
test('family rename, delete, and restore preserve data and enforce access across restarts', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nourish-family-lifecycle-'));
  process.env.DATA_DIR = dir; process.env.NODE_ENV = 'test'; process.env.LOCAL_DEV_AUTH = 'false';
  let app = await createApp(); await app.listen(0, '127.0.0.1');
  let base = await app.getUrl();
  const store = app.get(DatabaseService), db = store.db;
  const admin: User = { id: 'owner', email: ADMIN_EMAIL, name: 'Owner', role: 'admin', status: 'active' };
  const member: User = { id: 'relative', email: 'relative@example.com', name: 'Relative', role: 'member', status: 'active' };
  for (const user of [admin, member]) {
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run(user.id, user.id, user.email, user.name, user.role, user.status);
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(user.id).digest('hex'), user.id, Date.now() + 3600_000);
  }
  db.prepare('INSERT INTO memberships VALUES (?,?)').run(member.id, 'family-default');
  const get = (url: string, user = admin) => fetch(`${base}/api/${url}`, { headers: { Cookie: `nb_session=${user.id}` } });
  const post = (url: string, data: unknown, user = admin) => fetch(`${base}/api/${url}`, { method: 'POST', headers: { Cookie: `nb_session=${user.id}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    assert.equal((await post('profile', profileInput)).status, 201);
    assert.equal((await post('plan', { id: 'me' })).status, 201);
    assert.equal((await post('log', { profileId: 'me', day: '2026-01-01', weight: 79.5 })).status, 201);
    assert.equal((await post('family', { id: 'family-default', name: 'Renamed Family' }, member)).status, 403);
    assert.equal((await post('family', { id: 'family-default', name: 'Renamed Family' })).status, 201);
    const renamed = await (await get('state', member)).json();
    assert.equal(renamed.families[0].name, 'Renamed Family');
    assert.equal(renamed.profiles.length, 2);
    assert.equal(renamed.plans.length, 1);
    const second = await (await post('family', { name: 'Other family' })).json();
    assert.equal((await post('family/delete', { id: 'family-default', confirmationName: 'Renamed Family' }, member)).status, 403);
    assert.equal((await get('family/deleted', member)).status, 403);
    assert.equal((await post('family/delete', { id: 'family-default', confirmationName: 'Our family' })).status, 400);
    assert.equal((await post('family/delete', { id: 'family-default', confirmationName: 'Renamed Family' })).status, 201);
    const hidden = await (await get('state', member)).json();
    for (const key of ['families', 'couples', 'profiles', 'plans', 'logs']) assert.equal(hidden[key].length, 0, `${key} must be hidden for deleted families`);
    assert.equal((await get('targets?id=me', member)).status, 403);
    assert.equal((await post('membership', { profileId: 'me', familyId: second.id })).status, 403);
    assert.equal((await post('admin/invitations', { email: member.email, familyId: 'family-default' })).status, 400);
    const untouched = await (await get('state')).json();
    assert.equal(untouched.families.length, 1);
    assert.equal(untouched.families[0].id, second.id);
    assert.equal((await post('family/restore', { id: 'family-default' }, member)).status, 403);
    assert.equal((await post('family/delete', { id: second.id, confirmationName: 'Other family' })).status, 201);
    await app.close();
    app = await createApp(); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    assert.equal((await (await get('state')).json()).families.length, 0, 'Startup must not recreate deleted pilot families');
    assert.equal((await (await get('family/deleted')).json()).length, 2);
    assert.equal((await post('family/restore', { id: 'family-default' })).status, 201);
    const restored = await (await get('state', member)).json();
    assert.equal(restored.families[0].name, 'Renamed Family');
    assert.equal(restored.profiles.length, 2);
    assert.equal(restored.profiles.find((p: { id: string }) => p.id === 'me').weight, 80);
    assert.equal(restored.couples.length, 1);
    assert.equal(restored.plans.length, 1);
    assert.equal(restored.logs[0].weight, 79.5);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
test('OAuth rejects forged state and expired attempts before contacting Google', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nourish-oauth-'));
  process.env.DATA_DIR = dir; process.env.NODE_ENV = 'test'; process.env.LOCAL_DEV_AUTH = 'false';
  const store = new DatabaseService();
  try {
    const auth = new AuthService(store);
    const response = { clearCookie() {} } as any;
    await assert.rejects(() => auth.callback({ query: { state: 'forged', code: 'abc' }, cookies: { nb_oauth: 'real' } } as any, response), /state did not match/);
    await assert.rejects(() => auth.callback({ query: { state: 'matching', code: 'abc' }, cookies: { nb_oauth: 'matching' } } as any, response), /expired/);
  } finally { store.onModuleDestroy(); await rm(dir, { recursive: true, force: true }); }
});
test('production cannot start with development auth enabled or without Google OAuth', async () => {
  process.env.NODE_ENV = 'production'; process.env.LOCAL_DEV_AUTH = 'true';
  await assert.rejects(() => createApp(), /Production requires/);
  process.env.NODE_ENV = 'test'; process.env.LOCAL_DEV_AUTH = 'false';
});
