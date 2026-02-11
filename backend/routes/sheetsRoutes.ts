import { Router } from 'express';
import type { Env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { exportToGoogleSheet, type SheetExportRequest } from '../services/sheetsService.js';
import { writeAuditLog } from '../services/audit.js';

export function sheetsRoutes(env: Env): Router {
  const router = Router();

  // All sheets endpoints require authentication
  router.use(requireAuth(env));

  /**
   * POST /api/sheets/export
   * Creates a new Google Spreadsheet from provided headers + rows.
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

      const result = await exportToGoogleSheet(env, { title, sheetName, headers, rows: sanitizedRows });

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
    } catch (err) {
      next(err);
    }
  });

  return router;
}
