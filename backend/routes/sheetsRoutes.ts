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
   * 
   * SECURITY NOTE: This endpoint accepts data from the request body without
   * verifying that the user is authorized to export that specific data.
   * The security model assumes:
   * 1. Data is fetched from other authorized endpoints first (e.g., /api/orders, /api/payouts)
   * 2. Those endpoints enforce proper role-based access control
   * 3. The frontend then passes the authorized data to this export endpoint
   * 4. This endpoint validates data format/size but not authorization
   * 
   * Alternative architectures to consider for future enhancement:
   * - Accept entity IDs instead of raw data, and fetch authorized data server-side
   * - Add role-based validation to ensure data structure matches user's role
   * - Implement server-side data source tracking to verify data origin
   */
  router.post('/export', async (req, res, next) => {
    try {
      const { title, sheetName, headers, rows } = req.body as SheetExportRequest;

      if (!title || typeof title !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'title is required' } });
      }
      if (title.length > 255) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'title must not exceed 255 characters' } });
      }
      if (sheetName && typeof sheetName !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'sheetName must be a string' } });
      }
      if (sheetName && sheetName.length > 255) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'sheetName must not exceed 255 characters' } });
      }
      if (!Array.isArray(headers) || headers.length === 0) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'headers must be a non-empty array' } });
      }
      if (headers.length > 100) {
        return res.status(400).json({ error: { code: 'TOO_MANY_COLUMNS', message: 'Maximum 100 columns per export' } });
      }
      // Validate individual header types
      if (!headers.every((h: unknown) => typeof h === 'string' && h.length > 0)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'All headers must be non-empty strings' } });
      }
      
      // Sanitize headers: prevent formula injection
      const sanitizedHeaders = headers.map((h: string) => {
        if (/^[=+\-@\t\r\n]/.test(h)) {
          return `'${h}`;
        }
        return h;
      });
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'rows must be an array' } });
      }
      // Safety limit: max 50,000 rows per export
      if (rows.length > 50_000) {
        return res.status(400).json({ error: { code: 'TOO_MANY_ROWS', message: 'Maximum 50,000 rows per export' } });
      }
      // Sanitize rows: coerce cells to string/number/null only AND prevent formula injection
      const sanitizedRows = rows.map((row: unknown[], idx: number) => {
        if (!Array.isArray(row)) return [];
        // Warn if row has different number of cells than headers
        if (row.length !== sanitizedHeaders.length) {
          console.warn(`Row ${idx} has ${row.length} cells but ${sanitizedHeaders.length} headers expected`);
        }
        return row.map((cell: unknown) => {
          if (cell === null || cell === undefined) return null;
          if (typeof cell === 'number') return cell;
          const str = String(cell);
          // Prevent formula injection: prefix with single quote if starts with =, +, -, @, tab, return, or newline
          if (/^[=+\-@\t\r\n]/.test(str)) {
            return `'${str}`;
          }
          return str;
        });
      });

      const result = await exportToGoogleSheet(env, { title, sheetName, headers: sanitizedHeaders, rows: sanitizedRows });

      // Audit trail
      await writeAuditLog({
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
