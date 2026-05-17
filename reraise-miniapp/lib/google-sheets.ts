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
    (sheet: any) => sheet.properties?.title === tabName
  );

  if (existingSheet?.properties?.sheetId != null) {
    return {
      sheetId: existingSheet.properties.sheetId,
      tabName,
      created: false,
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
    created: true,
  };
}

export async function ensureReadmeTab() {
  return ensureSpreadsheetTab("README");
}

export async function appendReportRow(title: string, tabName: string) {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Лист1!A:M",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        title,
        tabName,
        '=ЕСЛИ(INDIRECT("B"&ROW())="";"";ЕСЛИОШИБКА(СЧЁТЕСЛИ(ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!F8:F200");ИСТИНА);""))',
        '=ЕСЛИ(INDIRECT("B"&ROW())="";"";ЕСЛИОШИБКА(СУММЕСЛИ(ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!F8:F200");ИСТИНА;ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!G8:G200"));""))',
        '=ЕСЛИ(INDIRECT("B"&ROW())="";"";ЕСЛИОШИБКА(СУММЕСЛИ(ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!F8:F200");ИСТИНА;ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!H8:H200"));""))',
        '=ЕСЛИ(INDIRECT("B"&ROW())="";"";ЕСЛИОШИБКА(СУММЕСЛИ(ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!F8:F200");ИСТИНА;ДВССЫЛ("\'"&INDIRECT("B"&ROW())&"\'!I8:I200"));""))',
        "=INDIRECT(\"'\"&INDIRECT(\"B\"&ROW())&\"'!E2\")",
        "=INDIRECT(\"'\"&INDIRECT(\"B\"&ROW())&\"'!F2\")",
        "=INDIRECT(\"'\"&INDIRECT(\"B\"&ROW())&\"'!G2\")",
        '=ЕСЛИ(INDIRECT("C"&ROW())="";"";(INDIRECT("C"&ROW())+INDIRECT("D"&ROW()))*INDIRECT("G"&ROW())+INDIRECT("E"&ROW())*INDIRECT("H"&ROW())+INDIRECT("F"&ROW())*INDIRECT("I"&ROW()))',
        '=ЕСЛИ(INDIRECT("J"&ROW())="";"";INDIRECT("J"&ROW())*0,25)',
        "",
        '=ЕСЛИ(INDIRECT("K"&ROW())="";"";INDIRECT("K"&ROW())-INDIRECT("L"&ROW()))',
      ]],
    },
  });
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

export async function applyTournamentSheetFormatting(
  tabName: string,
  playerRowsCount?: number
) {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const targetSheet = spreadsheet.data.sheets?.find(
    (sheet: any) => sheet.properties?.title === tabName
  );

  const sheetId = targetSheet?.properties?.sheetId;

  if (sheetId == null) {
    throw new Error(`Spreadsheet tab "${tabName}" not found`);
  }

  const dataEndRowIndex = 7 + Math.max(playerRowsCount ?? 0, 0);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 7,
              },
            },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: 0,
              endIndex: 1,
            },
            properties: {
              hiddenByUser: true,
            },
            fields: "hiddenByUser",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 5,
              startColumnIndex: 2,
              endColumnIndex: 4,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.98,
                  green: 0.98,
                  blue: 0.98,
                },
                textFormat: {
                  bold: true,
                  foregroundColor: {
                    red: 0.1,
                    green: 0.1,
                    blue: 0.1,
                  },
                },
                wrapStrategy: "WRAP",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor,wrapStrategy)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 6,
              endRowIndex: 7,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.92,
                  green: 0.95,
                  blue: 0.99,
                },
                textFormat: {
                  bold: true,
                  foregroundColor: {
                    red: 0.1,
                    green: 0.1,
                    blue: 0.1,
                  },
                },
                wrapStrategy: "WRAP",
                horizontalAlignment: "CENTER",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,textFormat.bold,textFormat.foregroundColor,wrapStrategy,horizontalAlignment)",
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 7,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 1,
                  green: 1,
                  blue: 1,
                },
                verticalAlignment: "MIDDLE",
              },
            },
            fields:
              "userEnteredFormat(backgroundColor,verticalAlignment)",
          },
        },
        {
          updateBorders: {
            range: {
              sheetId,
              startRowIndex: 6,
              startColumnIndex: 0,
              endColumnIndex: 10,
            },
            top: {
              style: "SOLID",
              color: { red: 0.75, green: 0.78, blue: 0.82 },
            },
            bottom: {
              style: "SOLID",
              color: { red: 0.75, green: 0.78, blue: 0.82 },
            },
            left: {
              style: "SOLID",
              color: { red: 0.9, green: 0.9, blue: 0.9 },
            },
            right: {
              style: "SOLID",
              color: { red: 0.9, green: 0.9, blue: 0.9 },
            },
            innerHorizontal: {
              style: "SOLID",
              color: { red: 0.9, green: 0.9, blue: 0.9 },
            },
            innerVertical: {
              style: "SOLID",
              color: { red: 0.9, green: 0.9, blue: 0.9 },
            },
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
              hiddenByUser: true,
            },
            fields: "pixelSize,hiddenByUser",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 1,
              endIndex: 2,
            },
            properties: {
              pixelSize: 180,
              hiddenByUser: true,
            },
            fields: "pixelSize,hiddenByUser",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 2,
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
              endIndex: 4,
            },
            properties: {
              pixelSize: 140,
            },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 4,
              endIndex: 5,
            },
            properties: {
              pixelSize: 140,
            },
            fields: "pixelSize",
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: 5,
              endIndex: 10,
            },
            properties: {
              pixelSize: 110,
            },
            fields: "pixelSize",
          },
        },
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 7,
              endRowIndex: dataEndRowIndex,
              startColumnIndex: 5,
              endColumnIndex: 6,
            },
            rule: {
              condition: {
                type: "BOOLEAN",
              },
              strict: true,
              showCustomUi: true,
            },
          },
        },
        {
          addConditionalFormatRule: {
            index: 0,
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 4,
                  endRowIndex: 5,
                  startColumnIndex: 3,
                  endColumnIndex: 4,
                },
              ],
              booleanRule: {
                condition: {
                  type: "TEXT_EQ",
                  values: [{ userEnteredValue: "Открыт" }],
                },
                format: {
                  backgroundColor: {
                    red: 0.84,
                    green: 0.95,
                    blue: 0.85,
                  },
                  textFormat: {
                    bold: true,
                    foregroundColor: {
                      red: 0.11,
                      green: 0.4,
                      blue: 0.16,
                    },
                  },
                },
              },
            },
          },
        },
        {
          addConditionalFormatRule: {
            index: 1,
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 4,
                  endRowIndex: 5,
                  startColumnIndex: 3,
                  endColumnIndex: 4,
                },
              ],
              booleanRule: {
                condition: {
                  type: "TEXT_EQ",
                  values: [{ userEnteredValue: "Закрыт" }],
                },
                format: {
                  backgroundColor: {
                    red: 0.98,
                    green: 0.87,
                    blue: 0.87,
                  },
                  textFormat: {
                    bold: true,
                    foregroundColor: {
                      red: 0.62,
                      green: 0.13,
                      blue: 0.13,
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  });
}

export async function readSpreadsheetTabValues(tabName: string) {
  const sheets = getGoogleSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:Z`,
  });

  return response.data.values ?? [];
}

export async function writeTournamentLiveSheet(
  tabName: string,
  values: SheetCellValue[][]
) {
  await replaceSpreadsheetTabValues(tabName, values);
  await applyTournamentSheetFormatting(tabName, Math.max(values.length - 8, 0));
}

export function buildSpreadsheetTabUrl(sheetId: number) {
  return `https://docs.google.com/spreadsheets/d/${getSpreadsheetId()}/edit#gid=${sheetId}`;
}
