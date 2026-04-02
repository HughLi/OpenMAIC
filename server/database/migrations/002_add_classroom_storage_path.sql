-- Migration: Add storage_path and sync_status to classrooms table
-- For tracking user-isolated file storage locations

-- Add storage_path column to track where classroom data is stored
ALTER TABLE classrooms ADD COLUMN storage_path TEXT;

-- Add sync_status column to track cloud sync state
-- Values: 'local', 'syncing', 'synced', 'error'
ALTER TABLE classrooms ADD COLUMN sync_status TEXT DEFAULT 'local' CHECK(sync_status IN ('local', 'syncing', 'synced', 'error'));

-- Add index on storage_path for quick lookups
CREATE INDEX IF NOT EXISTS idx_classrooms_storage_path ON classrooms(storage_path);

-- Add index on sync_status for filtering by sync state
CREATE INDEX IF NOT EXISTS idx_classrooms_sync_status ON classrooms(sync_status);
