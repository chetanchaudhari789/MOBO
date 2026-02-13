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
 * Initiate Google OAuth in a popup window.
 * Returns a promise that resolves when the popup completes (success or failure).
 */
export async function connectGoogleAccount(): Promise<boolean> {
  try {
    const { url } = await api.google.getAuthUrl();
    return new Promise<boolean>((resolve) => {
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        url,
        'google-oauth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
      );

      if (!popup) {
        resolve(false);
        return;
      }

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'GOOGLE_OAUTH_RESULT') {
          window.removeEventListener('message', handleMessage);
          clearInterval(pollTimer);
          resolve(!!event.data.success);
        }
      };

      window.addEventListener('message', handleMessage);

      // Fallback: poll for popup closure
      const pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', handleMessage);
          // If popup closed without a message, check connection status
          api.google.getStatus().then(s => resolve(s.connected)).catch(() => resolve(false));
        }
      }, 500);

      // Safety timeout: 5 minutes
      setTimeout(() => {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleMessage);
        if (!popup.closed) popup.close();
        resolve(false);
      }, 5 * 60 * 1000);
    });
  } catch {
    return false;
  }
}

/**
 * Export data to Google Sheets via backend API.
 * If the user hasn't connected their Google account, prompts them to do so first.
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
    // Check if user has Google connected — if not, initiate OAuth first
    let status: { connected: boolean } | null = null;
    try {
      status = await api.google.getStatus();
    } catch {
      // Google OAuth may not be configured — proceed anyway (will use service account)
    }

    if (status && !status.connected) {
      // Try to connect Google account first
      const connected = await connectGoogleAccount();
      if (!connected) {
        // User cancelled or failed — still proceed with service account fallback
        console.info('Google OAuth not completed — using service account fallback if available.');
      }
    }

    const result = await api.sheets.export({ title, headers, rows, sheetName });
    window.open(result.spreadsheetUrl, '_blank', 'noopener');
    onSuccess?.(result.spreadsheetUrl);
  } catch (err: any) {
    const code = err?.code;
    let msg: string;
    if (code === 'SHEETS_AUTH_NOT_CONFIGURED') {
      msg = 'Google Sheets export is not configured yet. Please contact your administrator to set up Google Cloud credentials.';
    } else if (code === 'GOOGLE_OAUTH_NOT_CONFIGURED') {
      msg = 'Google account connection is not available on this server.';
    } else {
      msg = err?.message || 'Google Sheets export failed. Please try again later.';
    }
    onError?.(msg);
  } finally {
    onEnd?.();
  }
}
