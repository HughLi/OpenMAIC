-- Migration: Add category and cover_image to classrooms
-- Date: 2024-04-01

-- Add category column with predefined categories
ALTER TABLE classrooms ADD COLUMN category TEXT DEFAULT 'other';

-- Add cover_image column for storing cover image path
ALTER TABLE classrooms ADD COLUMN cover_image TEXT;

-- Create index on category for filtering
CREATE INDEX IF NOT EXISTS idx_classrooms_category ON classrooms(category);

-- Update existing classrooms with default values
UPDATE classrooms SET category = 'programming' WHERE category = 'other' AND title LIKE '%编程%';
UPDATE classrooms SET category = 'design' WHERE category = 'other' AND title LIKE '%设计%';
UPDATE classrooms SET category = 'business' WHERE category = 'other' AND title LIKE '%商业%';
UPDATE classrooms SET category = 'data-science' WHERE category = 'other' AND title LIKE '%数据%';
