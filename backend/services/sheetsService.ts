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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Google access token: ${res.status} — ${text}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
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
  });

  if (!res.ok) {
    const text = await res.text();
    // Sanitize error message to avoid exposing Google API internals
    throw new Error(`Failed to create spreadsheet (status ${res.status}). Please check your Google Sheets API credentials.`);
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
  });

  if (!res.ok) {
    const text = await res.text();
    // Sanitize error message to avoid exposing Google API internals
    throw new Error(`Failed to append data to spreadsheet (status ${res.status}). Please check your Google Sheets API credentials.`);
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
  });

  if (!res.ok) {
    console.warn('Google Sheets formatting warning:', await res.text());
  }
}

// ─── Public API ───

export async function exportToGoogleSheet(
  env: Env,
  request: SheetExportRequest,
): Promise<SheetExportResult> {
  // Try service account first (proper write access)
  const serviceAccount = parseServiceAccountKey(env);
  let authHeader: Record<string, string>;

  if (serviceAccount) {
    const accessToken = await getAccessToken(serviceAccount);
    authHeader = { Authorization: `Bearer ${accessToken}` };
  } else {
    // Fallback to API key — may fail for write operations
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Google Sheets export requires either GOOGLE_SERVICE_ACCOUNT_KEY (recommended) or GEMINI_API_KEY. ' +
        'For write access, create a Google Cloud service account, download the JSON key, base64-encode it, ' +
        'and set it as GOOGLE_SERVICE_ACCOUNT_KEY.'
      );
    }
    // API key auth uses query parameter, so we need to modify URLs
    // For simplicity, we'll add it as a custom header marker and handle it differently
    // NOTE: API keys typically cannot create/write spreadsheets (403 error expected)
    console.warn('Using API key for Google Sheets — write operations may fail. Use GOOGLE_SERVICE_ACCOUNT_KEY for reliable access.');
    // For API key auth, we can't use headers — Google expects ?key= query param
    // The Sheets API functions below accept authHeader, so we pass a special marker
    // that tells them to skip header-based auth. The key is appended to URLs separately.
    authHeader = {};
  }

  const sheetName = request.sheetName || 'Sheet1';
  const apiKeyParam = !serviceAccount ? `?key=${encodeURIComponent(env.GEMINI_API_KEY!)}` : '';

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

  return { spreadsheetId, spreadsheetUrl, sheetTitle: request.title };
}
