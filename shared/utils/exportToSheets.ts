import { api } from '../services/api';

export interface SheetsExportOptions {
  title: string;
  headers: string[];
  rows: (string | number)[][];
  sheetName?: string;
  onSuccess?: (url: string) => void;
  onError?: (msg: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Export data to Google Sheets via backend API.
 * Opens the spreadsheet in a new tab on success.
 */
export async function exportToGoogleSheet(opts: SheetsExportOptions): Promise<void> {
  const { title, headers, rows, sheetName, onSuccess, onError, onStart, onEnd } = opts;

  if (!rows.length) {
    onError?.('No data available to export.');
    return;
  }

  onStart?.();
  try {
    const result = await api.sheets.export({ title, headers, rows, sheetName });
    window.open(result.spreadsheetUrl, '_blank', 'noopener');
    onSuccess?.(result.spreadsheetUrl);
  } catch (err: any) {
    const msg = err?.message || 'Google Sheets export failed';
    onError?.(msg);
  } finally {
    onEnd?.();
  }
}
