import { google } from "googleapis";

type SheetCellValue = string | number | boolean | null;

function normalizePrivateKey(rawValue: string | undefined) {
  if (!rawValue) {
    return rawValue;
  }

  const trimmed = rawValue.trim();
  const unwrapped =
    trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;

  return unwrapped.replace(/\\n/g, "\n");
}

function getGoogleSheetsClient() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY);

  if (!clientEmail || !privateKey) {
    throw new Error("Google Sheets environment variables are not configured");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });

  return google.sheets({ version: "v4", auth });
}

export function getSpreadsheetId() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID is not configured");
  }

  return spreadsheetId;
}

export async function ensureSpreadsheetTab(tabName: string) {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === tabName
  );

  if (existingSheet?.properties?.sheetId != null) {
    return {
      sheetId: existingSheet.properties.sheetId,
      tabName,
    };
  }

  const createResponse = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tabName,
            },
          },
        },
      ],
    },
  });

  const sheetId =
    createResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;

  if (sheetId == null) {
    throw new Error("Failed to create spreadsheet tab");
  }

  return {
    sheetId,
    tabName,
  };
}

export async function ensureReadmeTab() {
  return ensureSpreadsheetTab("README");
}

export async function replaceSpreadsheetTabValues(
  tabName: string,
  values: SheetCellValue[][]
) {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values,
    },
  });
}

export async function applyTournamentSheetFormatting(tabName: string) {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const targetSheet = spreadsheet.data.sheets?.find(
    (sheet) => sheet.properties?.title === tabName
  );

  const sheetId = targetSheet?.properties?.sheetId;

  if (sheetId == null) {
    throw new Error(`Spreadsheet tab "${tabName}" not found`);
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 13,
              },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 5,
              startColumnIndex: 0,
              endColumnIndex: 2,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.08,
                  green: 0.08,
                  blue: 0.08,
                },
                textFormat: {
                  bold: true,
                },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat.bold)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 6,
              endRowIndex: 12,
              startColumnIndex: 0,
              endColumnIndex: 9,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.96,
                  green: 0.97,
                  blue: 1,
                },
                textFormat: {
                  foregroundColor: {
                    red: 0.12,
                    green: 0.18,
                    blue: 0.28,
                  },
                },
                wrapStrategy: "WRAP",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat.foregroundColor,wrapStrategy)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 12,
              endRowIndex: 13,
              startColumnIndex: 0,
              endColumnIndex: 9,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.86,
                  green: 0.9,
                  blue: 0.96,
                },
                textFormat: {
                  bold: true,
                },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat.bold)",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 1,
            },
            properties: {
              pixelSize: 180,
            },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 1,
              endIndex: 3,
            },
            properties: {
              pixelSize: 180,
            },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 3,
              endIndex: 9,
            },
            properties: {
              pixelSize: 130,
            },
            fields: "pixelSize",
          },
        },
      ],
    },
  });
}

export function buildSpreadsheetTabUrl(sheetId: number) {
  return `https://docs.google.com/spreadsheets/d/${getSpreadsheetId()}/edit#gid=${sheetId}`;
}
