/**
 * Google Sheets Export Service
 *
 * Creates a new Google Spreadsheet populated with order/payout data.
 * Uses Google Service Account JWT for authentication (write access).
 * Falls back to Gemini API key for read-only access.
 *
 * Set GOOGLE_SERVICE_ACCOUNT_KEY env var to a base64-encoded JSON
 * of the service account key file (download from Google Cloud Console).
 *
 * Uses raw REST API calls — no `googleapis` npm package needed.
 */

import * as crypto from 'crypto';
import type { Env } from '../config/env.js';

// ─── Types ───

export interface SheetExportRow {
  [key: string]: string | number | boolean | null | undefined;
}

export interface SheetExportRequest {
  title: string;
  sheetName?: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export interface SheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
}

// ─── JWT / Service Account Auth ───

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

function parseServiceAccountKey(env: Env): ServiceAccountKey | null {
  const raw = (env as any).GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  try {
    // Try base64-encoded JSON first, then plain JSON
    let json: string;
    try {
      json = Buffer.from(raw, 'base64').toString('utf-8');
      // Verify it's valid JSON
      JSON.parse(json);
    } catch {
      json = raw; // Assume it's already plain JSON
    }
    const parsed = JSON.parse(json);
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      project_id: parsed.project_id,
    };
  } catch {
    return null;
  }
}

function createJwt(serviceAccount: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
  };

  const encode = (obj: any) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsignedToken = `${encode(header)}.${encode(payload)}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  sign.end();
  const signature = sign.sign(serviceAccount.private_key, 'base64url');

  return `${unsignedToken}.${signature}`;
}

async function getAccessToken(serviceAccount: ServiceAccountKey): Promise<string> {
  const jwt = createJwt(serviceAccount);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Google access token: ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ─── User OAuth Token Refresh ───

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * Refresh a user's Google access token using their stored refresh token.
 * Returns a fresh access token or null if the refresh fails (token revoked, etc.).
 */
export async function refreshUserGoogleToken(
  refreshToken: string,
  env: Env,
): Promise<string | null> {
  const clientId = (env as any).GOOGLE_CLIENT_ID;
  const clientSecret = (env as any).GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn('Google token refresh failed:', await res.text());
      return null;
    }

    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  } catch (err) {
    console.warn('Google token refresh error:', err);
    return null;
  }
}

// ─── Google Sheets REST helpers ───

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function createSpreadsheet(
  authHeader: Record<string, string>,
  title: string,
  sheetName: string,
  apiKeyParam = '',
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const body = {
    properties: { title },
    sheets: [
      {
        properties: {
          title: sheetName,
          gridProperties: { frozenRowCount: 1 },
        },
      },
    ],
  };

  const res = await fetch(`${SHEETS_API}${apiKeyParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API error (create): ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string };
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
  };
}

async function appendRows(
  authHeader: Record<string, string>,
  spreadsheetId: string,
  sheetName: string,
  values: (string | number | null | undefined)[][],
  apiKeyParam = '',
): Promise<void> {
  const range = `${sheetName}!A1`;
  const sep = apiKeyParam ? '&' : '?';
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append${apiKeyParam}${sep}valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ values }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API error (append): ${res.status} — ${text}`);
  }
}

async function formatHeaderRow(
  authHeader: Record<string, string>,
  spreadsheetId: string,
  sheetId: number,
  columnCount: number,
  apiKeyParam = '',
): Promise<void> {
  const requests = [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
    {
      autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: columnCount },
      },
    },
  ];

  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate${apiKeyParam}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ requests }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    console.warn('Google Sheets formatting warning:', await res.text());
  }
}

// ─── Auto-share via Google Drive API ───

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

/**
 * Share a Google Drive file (spreadsheet) with a specific email.
 * Uses the Drive API to create a "writer" permission so the user
 * gets direct access without manual approval.
 */
async function shareWithUser(
  authHeader: Record<string, string>,
  spreadsheetId: string,
  email: string,
): Promise<void> {
  try {
    const url = `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}/permissions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        type: 'user',
        role: 'writer',
        emailAddress: email,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`Google Drive share warning: ${res.status} — ${await res.text()}`);
    }
  } catch (err) {
    // Non-critical: user can still access via the URL if they have the link
    console.warn('Google Drive share failed (non-critical):', err);
  }
}

/**
 * Make a Google Drive file (spreadsheet) accessible to anyone with the link.
 * Fallback when we don't know the user's email.
 */
async function makePublicReadable(
  authHeader: Record<string, string>,
  spreadsheetId: string,
): Promise<void> {
  try {
    const url = `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}/permissions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        type: 'anyone',
        role: 'reader',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`Google Drive public share warning: ${res.status} — ${await res.text()}`);
    }
  } catch (err) {
    console.warn('Google Drive public share failed (non-critical):', err);
  }
}

// ─── Public API ───

export async function exportToGoogleSheet(
  env: Env,
  request: SheetExportRequest,
  userAccessToken?: string | null,
  sharingEmail?: string | null,
): Promise<SheetExportResult> {
  let authHeader: Record<string, string>;
  let isServiceAccount = false;

  if (userAccessToken) {
    // Prefer user's own OAuth token — sheet will be created in THEIR Google Drive
    authHeader = { Authorization: `Bearer ${userAccessToken}` };
  } else {
    // Fallback to service account
    const serviceAccount = parseServiceAccountKey(env);
    if (!serviceAccount) {
      throw new Error(
        'GOOGLE_SHEETS_AUTH_MISSING: Google Sheets export requires either a connected Google account ' +
        'or a server-configured Service Account. Please connect your Google account first, ' +
        'or ask your administrator to configure a Google Cloud Service Account.'
      );
    }
    const accessToken = await getAccessToken(serviceAccount);
    authHeader = { Authorization: `Bearer ${accessToken}` };
    isServiceAccount = true;
  }

  const sheetName = request.sheetName || 'Sheet1';
  const apiKeyParam = '';

  // 1. Create the spreadsheet
  const { spreadsheetId, spreadsheetUrl } = await createSpreadsheet(authHeader, request.title, sheetName, apiKeyParam);

  // 2. Write header + data rows
  const allRows: (string | number | null | undefined)[][] = [
    request.headers,
    ...request.rows,
  ];

  const CHUNK_SIZE = 5000;
  for (let i = 0; i < allRows.length; i += CHUNK_SIZE) {
    const chunk = allRows.slice(i, i + CHUNK_SIZE);
    // eslint-disable-next-line no-await-in-loop
    await appendRows(authHeader, spreadsheetId, sheetName, chunk, apiKeyParam);
  }

  // 3. Format header row (non-critical)
  try {
    await formatHeaderRow(authHeader, spreadsheetId, 0, request.headers.length, apiKeyParam);
  } catch {
    // Ignore formatting errors
  }

  // 4. When using service account, require a sharing email to ensure the sheet
  //    is shared with a specific user rather than making it publicly accessible.
  if (isServiceAccount) {
    if (!sharingEmail) {
      throw new Error(
        'GOOGLE_SHEETS_SHARING_EMAIL_REQUIRED: When exporting via the service account, ' +
        'a sharingEmail must be provided so the spreadsheet can be shared with a specific user. ' +
        'Please supply a sharingEmail or connect a Google account to export directly to the user\'s Drive.'
      );
    }

    await shareWithUser(authHeader, spreadsheetId, sharingEmail);
  }

  return { spreadsheetId, spreadsheetUrl, sheetTitle: request.title };
}
