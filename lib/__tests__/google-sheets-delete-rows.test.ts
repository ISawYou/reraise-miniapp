import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/google-sheets.ts::deleteSpreadsheetTabRows -- the narrow row-deletion
// primitive. googleapis is faked; nothing reaches a real spreadsheet.
const api = vi.hoisted(() => ({
  get: vi.fn(),
  batchUpdate: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn() },
    sheets: () => ({ spreadsheets: { get: api.get, batchUpdate: api.batchUpdate } }),
  },
}));

const { deleteSpreadsheetTabRows } = await import("@/lib/google-sheets");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_EMAIL = "svc@example.invalid";
  process.env.GOOGLE_PRIVATE_KEY = "fake-key";
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet-test-id";
  api.get.mockResolvedValue({
    data: { sheets: [{ properties: { title: "Other", sheetId: 1 } }, { properties: { title: "Tab", sheetId: 42 } }] },
  });
  api.batchUpdate.mockResolvedValue({});
});

describe("deleteSpreadsheetTabRows", () => {
  it("deletes whole rows of the right tab in ONE batch, in DESCENDING order, de-duplicated", async () => {
    const deleted = await deleteSpreadsheetTabRows("Tab", [9, 14, 9, 11], 8);

    expect(deleted).toEqual([14, 11, 9]);
    expect(api.batchUpdate).toHaveBeenCalledTimes(1);
    const requests = api.batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(requests).toEqual(
      [14, 11, 9].map((rowNumber) => ({
        deleteDimension: {
          range: { sheetId: 42, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
        },
      }))
    );
  });

  it("refuses to touch the header/meta block (row below the minimum) -- no API call at all", async () => {
    await expect(deleteSpreadsheetTabRows("Tab", [12, 7], 8)).rejects.toThrow("protected sheet row 7");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.batchUpdate).not.toHaveBeenCalled();
  });

  it("no rows => no API call", async () => {
    await expect(deleteSpreadsheetTabRows("Tab", [], 8)).resolves.toEqual([]);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("unknown tab => throws, nothing deleted", async () => {
    await expect(deleteSpreadsheetTabRows("Missing", [9], 8)).rejects.toThrow('Spreadsheet tab "Missing" not found');
    expect(api.batchUpdate).not.toHaveBeenCalled();
  });
});
