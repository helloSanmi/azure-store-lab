-- Azure Store Lab: database schema (Azure SQL / SQL Server).
-- Idempotent: safe to run repeatedly. The app runs this on startup, or you can
-- run it yourself against the database. It assumes the database already exists
-- (on Azure SQL the database is provisioned separately); it only creates tables.

-- Accounts. One row per signed-up user. (Replaces the old Azure Table Storage.)
IF OBJECT_ID(N'dbo.users', N'U') IS NULL
CREATE TABLE dbo.users (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_users PRIMARY KEY DEFAULT NEWID(),
    name        NVARCHAR(200)    NOT NULL,
    email       NVARCHAR(320)    NOT NULL,
    created_at  DATETIME2(0)     NOT NULL CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME()
);

-- One account per email address.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_users_email' AND object_id = OBJECT_ID(N'dbo.users'))
CREATE UNIQUE INDEX UX_users_email ON dbo.users(email);

-- Metadata for each private file in "My Files". The bytes live in Blob Storage,
-- in the container named after the owner's id, as a blob named after this row's id.
IF OBJECT_ID(N'dbo.files', N'U') IS NULL
CREATE TABLE dbo.files (
    id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_files PRIMARY KEY DEFAULT NEWID(),
    owner_id      UNIQUEIDENTIFIER NOT NULL,
    display_name  NVARCHAR(255)    NOT NULL,
    content_type  NVARCHAR(150)    NULL,
    size_bytes    BIGINT           NOT NULL CONSTRAINT DF_files_size DEFAULT 0,
    uploaded_at   DATETIME2(0)     NOT NULL CONSTRAINT DF_files_uploaded DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_files_owner FOREIGN KEY (owner_id) REFERENCES dbo.users(id) ON DELETE CASCADE
);

-- Fast "list my files".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_files_owner' AND object_id = OBJECT_ID(N'dbo.files'))
CREATE INDEX IX_files_owner ON dbo.files(owner_id);

-- A user can't have two files with the same name.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_files_owner_name' AND object_id = OBJECT_ID(N'dbo.files'))
CREATE UNIQUE INDEX UX_files_owner_name ON dbo.files(owner_id, display_name);

-- Azure Blob access tier for each file: Hot / Cool / Archive. Added via ALTER so
-- existing databases pick it up without recreating the table.
IF COL_LENGTH(N'dbo.files', N'access_tier') IS NULL
ALTER TABLE dbo.files ADD access_tier NVARCHAR(20) NOT NULL CONSTRAINT DF_files_tier DEFAULT 'Hot';

-- Soft delete (recycle bin): when set, the file is in the bin, hidden from the
-- normal listing but restorable. NULL = active. The unique index above still
-- covers deleted rows, so a name stays reserved until the file is restored or
-- permanently purged (mirrors how Azure Blob soft delete retains the blob).
IF COL_LENGTH(N'dbo.files', N'deleted_at') IS NULL
ALTER TABLE dbo.files ADD deleted_at DATETIME2(3) NULL;

-- Append-only activity log: who did what, when. A simple event table (the kind of
-- thing NoSQL is also good at), read back with a JOIN to users for the actor name.
IF OBJECT_ID(N'dbo.activity', N'U') IS NULL
CREATE TABLE dbo.activity (
    id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_activity PRIMARY KEY DEFAULT NEWID(),
    actor_id    UNIQUEIDENTIFIER NOT NULL,
    action      NVARCHAR(40)     NOT NULL,
    target      NVARCHAR(255)    NULL,
    area        NVARCHAR(20)     NOT NULL,
    created_at  DATETIME2(3)     NOT NULL CONSTRAINT DF_activity_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_activity_actor FOREIGN KEY (actor_id) REFERENCES dbo.users(id) ON DELETE CASCADE
);

-- Fast "recent activity".
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_activity_created' AND object_id = OBJECT_ID(N'dbo.activity'))
CREATE INDEX IX_activity_created ON dbo.activity(created_at DESC);
