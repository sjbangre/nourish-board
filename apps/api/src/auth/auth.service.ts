import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import type { Request, Response } from 'express';
import type { User } from '@nourish/contracts';
import { DatabaseService } from '../database/database.service';

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'suhas.bangre@gmail.com').trim().toLowerCase();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const isProduction = () => process.env.NODE_ENV === 'production';
const cookie = () => ({ httpOnly: true, secure: isProduction(), sameSite: 'lax' as const, path: '/' });
export function canAdmin(user: User) { return user.role === 'admin' && user.status === 'active' && user.email.toLowerCase() === ADMIN_EMAIL; }

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${process.env.APP_URL || 'http://localhost:4318'}/api/auth/google/callback`);
  constructor(private readonly store: DatabaseService) {}
  configured() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }
  localMode() { return !isProduction() && process.env.LOCAL_DEV_AUTH === 'true'; }
  session(req: Request): User | null {
    if (this.localMode()) return { id: 'local-admin', name: 'Local development admin', email: ADMIN_EMAIL, role: 'admin', status: 'active' };
    const token = req.cookies?.nb_session;
    if (typeof token !== 'string') return null;
    const row = this.store.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?').get(hash(token), Date.now());
    return row ? this.store.user(String(row.user_id)) || null : null;
  }
  async begin(res: Response) {
    if (!this.configured()) throw new UnauthorizedException('Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    const codes = await this.google.generateCodeVerifierAsync();
    this.store.db.prepare('DELETE FROM oauth_attempts WHERE expires<?').run(Date.now());
    this.store.db.prepare('INSERT INTO oauth_attempts VALUES (?,?,?,?)').run(hash(state), codes.codeVerifier, nonce, Date.now() + 600_000);
    res.cookie('nb_oauth', state, { ...cookie(), maxAge: 600_000 });
    res.redirect(this.google.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce, code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256, prompt: 'select_account' }));
  }
  async callback(req: Request, res: Response) {
    const state = req.query.state, storedState = req.cookies?.nb_oauth, code = req.query.code;
    res.clearCookie('nb_oauth', cookie());
    if (typeof state !== 'string' || typeof storedState !== 'string' || typeof code !== 'string') throw new UnauthorizedException('Invalid or cancelled Google sign-in.');
    const a = Buffer.from(state), b = Buffer.from(storedState);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Sign-in state did not match.');
    const attempt = this.store.db.prepare('SELECT * FROM oauth_attempts WHERE state_hash=? AND expires>?').get(hash(state), Date.now());
    this.store.db.prepare('DELETE FROM oauth_attempts WHERE state_hash=?').run(hash(state));
    if (!attempt) throw new UnauthorizedException('Sign-in expired or was already used.');
    const { tokens } = await this.google.getToken({ code, codeVerifier: String(attempt.verifier) });
    if (!tokens.id_token) throw new UnauthorizedException('Google did not return an identity token.');
    const ticket = await this.google.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || !identity.email_verified || (identity as unknown as { nonce?: string }).nonce !== attempt.nonce) throw new UnauthorizedException('Google identity could not be verified.');
    const email = identity.email.toLowerCase(), admin = email === ADMIN_EMAIL;
    let user = this.store.db.prepare('SELECT id FROM users WHERE google_id=? OR email=?').get(identity.sub, email);
    const id = user ? String(user.id) : randomUUID();
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET google_id=excluded.google_id,email=excluded.email,name=excluded.name,role=excluded.role`).run(id, identity.sub, email, identity.name || email, admin ? 'admin' : 'member', admin ? 'active' : 'pending');
      if (admin) this.store.db.prepare("UPDATE users SET status='active',role='admin' WHERE id=?").run(id);
      const invitations = this.store.db.prepare("SELECT i.family_id FROM invitations i JOIN families f ON f.id=i.family_id WHERE i.email=? AND i.status='approved' AND f.archived_at IS NULL").all(email);
      for (const invite of invitations) this.store.db.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?)').run(id, invite.family_id);
      if (invitations.length) this.store.db.prepare("UPDATE users SET status='active' WHERE id=?").run(id);
    });
    const session = randomBytes(32).toString('base64url');
    this.store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.store.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(session), id, Date.now() + 7 * 86400_000);
    res.cookie('nb_session', session, { ...cookie(), maxAge: 7 * 86400_000 });
    // Tokens are not retained; the app requests identity only, not Google data.
    res.redirect(process.env.APP_URL || 'http://localhost:4318');
  }
  logout(req: Request, res: Response) {
    if (typeof req.cookies?.nb_session === 'string') this.store.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(req.cookies.nb_session));
    res.clearCookie('nb_session', cookie());
    return { ok: true };
  }
  assertAdmin(user: User) { if (!canAdmin(user)) throw new ForbiddenException('Only the administrator can approve invitations or change access.'); }
}
