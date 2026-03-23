-- Migration 011: Allow instructors to access the admin dashboard
ALTER TABLE instructors ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
