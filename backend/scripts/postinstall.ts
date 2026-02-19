#!/usr/bin/env tsx
/**
 * Postinstall script to generate Prisma client.
 * Silently skips if DATABASE_URL is not configured,
 * but logs warnings for other errors (like schema syntax errors).
 */

import { execSync } from 'node:child_process';

try {
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('✓ Prisma client generated successfully');
} catch (err: any) {
  // Check if DATABASE_URL is not set
  if (!process.env.DATABASE_URL) {
    console.log('ℹ Skipping Prisma client generation (DATABASE_URL not configured)');
    process.exit(0);
  }
  
  // For other errors, log a warning but don't fail the install
  console.warn('⚠ Warning: Prisma client generation failed');
  console.warn('  This could indicate a schema syntax error or connection issue.');
  console.warn('  Run "npm run pg:generate" manually to see the full error.');
  process.exit(0);
}
