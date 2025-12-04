-- Add resolution_type column to SafetyAlert table
-- This stores the type of resolution action taken (e.g., 'verified_safe', 'removed_from_sale', etc.)
ALTER TABLE "SafetyAlert" ADD COLUMN "resolutionType" TEXT;

