import 'reflect-metadata';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import {
  decodeSnapshot,
  importSnapshot,
} from '../apps/api/dist/database/snapshot.js';

process.env.DATABASE_PROVIDER = 'azure-sql';
process.env.DATABASE_MIGRATIONS = 'on';
const store = new DatabaseService();
try {
  await store.ready;
  if (process.env.INITIAL_SQLITE_SNAPSHOT) {
    const result = await importSnapshot(
      store.db,
      decodeSnapshot(process.env.INITIAL_SQLITE_SNAPSHOT),
    );
    console.log(
      result.imported
        ? 'Initial data imported successfully.'
        : 'Initial data was already imported; existing cloud edits preserved.',
    );
  }
  // SQL service-principal SIDs use client/application IDs; human users use
  // their Entra object IDs. Azure RBAC always uses principal object IDs.
  const runtime = process.env.SQL_RUNTIME_CLIENT_ID;
  const owner = process.env.SQL_OWNER_OBJECT_ID;
  for (const [name, id] of [['runtime client ID', runtime], ['owner object ID', owner]]) {
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`Missing or invalid SQL ${name}.`);
    }
  }
  async function grantUser(name, id, roles) {
    const allowedRoles = new Set(['db_datareader', 'db_datawriter', 'db_owner']);
    if (roles.some(role => !allowedRoles.has(role))) throw new Error('Unsupported SQL role.');
    const grants = roles.map(role => `
      IF IS_ROLEMEMBER(N'${role}',@name)<>1
      BEGIN
        SET @statement=N'ALTER ROLE [${role}] ADD MEMBER '+QUOTENAME(@name);
        EXEC sp_executesql @statement;
      END;
    `).join('\n');
    await store.db.prepare(`
      DECLARE @name nvarchar(128)=?;
      DECLARE @statement nvarchar(max);
      DECLARE @sid varbinary(16)=CONVERT(varbinary(16),CONVERT(uniqueidentifier,?));
      IF EXISTS(SELECT 1 FROM sys.database_principals WHERE name=@name AND sid<>@sid)
      BEGIN
        SET @statement=N'DROP USER '+QUOTENAME(@name);
        EXEC sp_executesql @statement;
      END;
      IF NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE name=@name)
      BEGIN
        SET @statement=N'CREATE USER '+QUOTENAME(@name)+N' WITH SID='+CONVERT(nvarchar(max),@sid,1)+N', TYPE=E';
        EXEC sp_executesql @statement;
      END;
      ${grants}
    `).run(name, id);
  }
  await store.db.transaction(async () => {
    await grantUser('nourish-runtime', runtime, ['db_datareader', 'db_datawriter']);
    await grantUser('nourish-owner', owner, ['db_owner']);
  });
  console.log('Schema migration, runtime access and owner database permissions are ready.');
} finally {
  await store.onModuleDestroy();
}
