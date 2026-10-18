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
  const principal = process.env.SQL_RUNTIME_PRINCIPAL_ID;
  if (!principal || !/^[0-9a-f-]{36}$/i.test(principal))
    throw new Error('Missing SQL runtime managed-identity principal ID.');
  await store.db.transaction(async () => {
    await store.db
      .prepare(
        `
      DECLARE @sid varbinary(16)=CONVERT(varbinary(16),CONVERT(uniqueidentifier,?));
      IF EXISTS(SELECT 1 FROM sys.database_principals WHERE name=N'nourish-runtime' AND sid<>@sid) DROP USER [nourish-runtime];
      IF NOT EXISTS(SELECT 1 FROM sys.database_principals WHERE name=N'nourish-runtime')
      BEGIN
        DECLARE @statement nvarchar(max)=N'CREATE USER [nourish-runtime] WITH SID='+CONVERT(nvarchar(max),@sid,1)+N', TYPE=E';
        EXEC sp_executesql @statement;
      END;
      IF IS_ROLEMEMBER(N'db_datareader',N'nourish-runtime')<>1 ALTER ROLE db_datareader ADD MEMBER [nourish-runtime];
      IF IS_ROLEMEMBER(N'db_datawriter',N'nourish-runtime')<>1 ALTER ROLE db_datawriter ADD MEMBER [nourish-runtime];
    `,
      )
      .run(principal);
  });
  console.log('Schema migration and runtime database permissions are ready.');
} finally {
  await store.onModuleDestroy();
}
