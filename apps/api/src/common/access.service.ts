import { ForbiddenException, Injectable, NotFoundException, Global, Module } from '@nestjs/common';
import type { User } from '@nourish/contracts';
import { DatabaseService } from '../database/database.service';
@Injectable()
export class AccessService {
  constructor(private readonly store: DatabaseService) {}
  family(user: User, id: string) { if (!this.store.familyIds(user).includes(id)) throw new ForbiddenException('This family is not shared with your account.'); }
  profile(user: User, id: string) { const p = this.store.profile(id); if (!p) throw new NotFoundException('Profile not found.'); this.family(user, p.familyId); return p; }
}
@Global() @Module({ providers: [AccessService], exports: [AccessService] })
export class AccessModule {}
