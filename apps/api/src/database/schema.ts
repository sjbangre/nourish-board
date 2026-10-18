export const sqliteSchema = `
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
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS data_imports(id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,imported_at TEXT NOT NULL);`;

export const azureSqlSchema = `
IF OBJECT_ID(N'dbo.families', N'U') IS NULL CREATE TABLE dbo.families(id nvarchar(100) NOT NULL PRIMARY KEY,name nvarchar(60) NOT NULL,archived_at nvarchar(40) NULL);
IF OBJECT_ID(N'dbo.profiles', N'U') IS NULL CREATE TABLE dbo.profiles(id nvarchar(100) NOT NULL PRIMARY KEY,body nvarchar(max) NOT NULL);
IF OBJECT_ID(N'dbo.foods', N'U') IS NULL CREATE TABLE dbo.foods(id nvarchar(100) NOT NULL PRIMARY KEY,body nvarchar(max) NOT NULL);
IF OBJECT_ID(N'dbo.plans', N'U') IS NULL CREATE TABLE dbo.plans(profile_id nvarchar(100) NOT NULL PRIMARY KEY REFERENCES dbo.profiles(id),body nvarchar(max) NOT NULL);
IF OBJECT_ID(N'dbo.logs', N'U') IS NULL CREATE TABLE dbo.logs(id nvarchar(100) NOT NULL PRIMARY KEY,profile_id nvarchar(100) NOT NULL REFERENCES dbo.profiles(id),day nvarchar(10) NOT NULL,weight float NOT NULL,note nvarchar(300) NOT NULL,UNIQUE(profile_id,day));
IF OBJECT_ID(N'dbo.couples', N'U') IS NULL CREATE TABLE dbo.couples(id nvarchar(100) NOT NULL PRIMARY KEY,family_id nvarchar(100) NOT NULL REFERENCES dbo.families(id),name nvarchar(60) NOT NULL);
IF OBJECT_ID(N'dbo.users', N'U') IS NULL BEGIN
  CREATE TABLE dbo.users(id nvarchar(100) NOT NULL PRIMARY KEY,google_id nvarchar(255) NULL,email nvarchar(254) NOT NULL UNIQUE,name nvarchar(255) NOT NULL,role nvarchar(20) NOT NULL,status nvarchar(20) NOT NULL);
  CREATE UNIQUE INDEX users_google_id ON dbo.users(google_id) WHERE google_id IS NOT NULL;
END;
IF OBJECT_ID(N'dbo.memberships', N'U') IS NULL CREATE TABLE dbo.memberships(user_id nvarchar(100) NOT NULL REFERENCES dbo.users(id),family_id nvarchar(100) NOT NULL REFERENCES dbo.families(id),PRIMARY KEY(user_id,family_id));
IF OBJECT_ID(N'dbo.invitations', N'U') IS NULL CREATE TABLE dbo.invitations(id nvarchar(100) NOT NULL PRIMARY KEY,email nvarchar(254) NOT NULL,family_id nvarchar(100) NOT NULL REFERENCES dbo.families(id),approved_by nvarchar(254) NOT NULL,created_at nvarchar(40) NOT NULL,status nvarchar(20) NOT NULL,UNIQUE(email,family_id));
IF OBJECT_ID(N'dbo.sessions', N'U') IS NULL CREATE TABLE dbo.sessions(token_hash nvarchar(64) NOT NULL PRIMARY KEY,user_id nvarchar(100) NOT NULL REFERENCES dbo.users(id),expires bigint NOT NULL);
IF OBJECT_ID(N'dbo.oauth_attempts', N'U') IS NULL CREATE TABLE dbo.oauth_attempts(state_hash nvarchar(64) NOT NULL PRIMARY KEY,verifier nvarchar(255) NOT NULL,nonce nvarchar(255) NOT NULL,expires bigint NOT NULL);
IF OBJECT_ID(N'dbo.schema_migrations', N'U') IS NULL CREATE TABLE dbo.schema_migrations(version int NOT NULL PRIMARY KEY,applied_at nvarchar(40) NOT NULL);
IF OBJECT_ID(N'dbo.data_imports', N'U') IS NULL CREATE TABLE dbo.data_imports(id nvarchar(100) NOT NULL PRIMARY KEY,source_hash nvarchar(64) NOT NULL,imported_at nvarchar(40) NOT NULL);`;
