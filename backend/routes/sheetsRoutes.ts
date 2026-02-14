import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { exportToGoogleSheet, refreshUserGoogleToken, type SheetExportRequest } from '../services/sheetsService.js';
import { writeAuditLog } from '../services/audit.js';
import { UserModel } from '../models/User.js';

export function sheetsRoutes(env: Env): Router {
  const router = Router();

  // All sheets endpoints require authentication
  router.use(requireAuth(env));

  /**
   * POST /api/sheets/export
   * Creates a new Google Spreadsheet from provided headers + rows.
   * If the user has a connected Google account, the sheet is created in THEIR Drive.
   * Otherwise falls back to the service account.
   * Body: { title, sheetName?, headers: string[], rows: (string|number|null)[][] }
   * Returns: { spreadsheetId, spreadsheetUrl, sheetTitle }
   */
  router.post('/export', async (req, res, next) => {
    try {
      const { title, sheetName, headers, rows } = req.body as SheetExportRequest;

      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'title is required' } });
      }
      if (!Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'headers must be a non-empty array' } });
      }
      // Validate individual header types
      if (!headers.every((h: unknown) => typeof h === 'string' && h.length > 0)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'All headers must be non-empty strings' } });
      }
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'rows must be an array' } });
      }
      // Safety limit: max 50,000 rows per export
      if (rows.length > 50_000) {
        return res.status(400).json({ error: { code: 'TOO_MANY_ROWS', message: 'Maximum 50,000 rows per export' } });
      }
      // Sanitize rows: coerce cells to string/number/null only
      const sanitizedRows = rows.map((row: unknown[]) => {
        if (!Array.isArray(row)) return [];
        return row.map((cell: unknown) => {
          if (cell === null || cell === undefined) return null;
          if (typeof cell === 'number') return cell;
          return String(cell);
        });
      });

      // Try user's own Google OAuth token first (sheet goes to THEIR Drive)
      let userAccessToken: string | null = null;
      try {
        const userId = (req as any).auth?.userId;
        if (userId) {
          const userDoc = await UserModel.findById(userId).select('+googleRefreshToken').lean();
          const refreshToken = (userDoc as any)?.googleRefreshToken;
          if (refreshToken) {
            userAccessToken = await refreshUserGoogleToken(refreshToken, env);
            if (!userAccessToken) {
              // Token refresh failed — clear invalid tokens
              await UserModel.findByIdAndUpdate(userId, {
                $unset: { googleRefreshToken: 1 },
              });
            }
          }
        }
      } catch {
        // Fall back to service account silently
      }

      const result = await exportToGoogleSheet(env, { title, sheetName, headers, rows: sanitizedRows }, userAccessToken);

      // Audit trail
      writeAuditLog({
        req,
        action: 'GOOGLE_SHEET_EXPORTED',
        entityType: 'Export',
        entityId: result.spreadsheetId,
        metadata: {
          spreadsheetId: result.spreadsheetId,
          title: result.sheetTitle,
          rowCount: rows.length,
        },
      });

      return res.json(result);
    } catch (err: any) {
      // Surface a clear error when Service Account auth is not configured
      if (err?.message?.includes('GOOGLE_SHEETS_AUTH_MISSING')) {
        return res.status(503).json({
          error: {
            code: 'SHEETS_AUTH_NOT_CONFIGURED',
            message: 'Google Sheets export is not available. The server administrator must configure a Google Cloud Service Account. See server logs for setup instructions.',
          },
        });
      }
      next(err);
    }
  });

  return router;
}
