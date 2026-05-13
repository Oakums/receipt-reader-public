// Mock Google Apps Script services
Object.assign(globalThis, {
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key: string) => {
        const props: { [key: string]: string } = {
          HUSBAND_NAME: '太郎',
          WIFE_NAME: '花子',
          ID_HUSBAND: '111111111111111111111111111111111',
          ID_WIFE: '222222222222222222222222222222222',
          SHEET_NAME: '家計簿',
          LINE_TOKEN: 'dummy_token',
          GEMINI_API_KEY: 'dummy_key'
        };
        return props[key] || `dummy_${key}`;
      }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: () => ({
        getLastRow: () => 1,
        getRange: () => ({
          getValues: () => [[]]
        }),
        appendRow: jest.fn(),
        getDataRange: () => ({
          getValues: () => []
        }),
        deleteRow: jest.fn()
      })
    })
  },
  UrlFetchApp: {
    fetch: jest.fn(() => ({
      getContentText: () => '{"candidates": [{"content": {"parts": [{"text": "合計：1000円\\n1. item"}]}}]}',
      getBlob: () => ({ getBytes: () => [] })
    }))
  },
  Utilities: {
    formatDate: jest.fn((date, tz, format) => 'formatted_date'),
    base64Encode: jest.fn(() => 'base64')
  }
});
