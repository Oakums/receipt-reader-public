// ==========================================
// 設定エリア
// test
// ==========================================
const props = PropertiesService.getScriptProperties();
const config = {
    LINE_TOKEN: props.getProperty('LINE_TOKEN') || 'LINEのチャネルアクセストークンをここに入れてください',
    GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY') || 'Google Gemini APIキーをここに入れてください',
    SHEET_NAME: '家計簿',
    ID_HUSBAND: props.getProperty('ID_HUSBAND') || '夫のLINEユーザーIDをここに入れてください',
    ID_WIFE: props.getProperty('ID_WIFE') || '妻のLINEユーザーIDをここに入れてください',
    HUSBAND_NAME: props.getProperty('HUSBAND_NAME') || '夫の名前をここに入れてください',
    WIFE_NAME: props.getProperty('WIFE_NAME') || '妻の名前をここに入れてください'
};
// ==========================================

interface LineEvent {
  replyToken: string;
  source: {
    userId: string;
  };
  message: {
    type: string;
    id?: string;
    text?: string;
  };
}

interface ReceiptData {
  date: Date;
  total: number;
  items: string;
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
  error?: {
    message: string;
  };
}

// ==========================================
// 定数定義
// ==========================================
const SHEET_COLUMNS = {
  DATE: 0,
  SENDER: 1,
  AMOUNT_INPUT: 2,
  AMOUNT_FINAL: 3,
  ITEMS: 4,
  MEMO: 5
} as const;

// ==========================================
// Repository層（スプレッドシート操作）
// ==========================================

class SheetRepository {
  private sheet: GoogleAppsScript.Spreadsheet.Sheet;

  constructor(sheetName: string) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    this.sheet = sheet;
  }

  getLastRowData(): any[] {
    const lastRow = this.sheet.getLastRow();
    if (lastRow <= 0) return [];
    const range = this.sheet.getRange(lastRow, 1, 1, 6);
    return range.getValues()[0];
  }

  updateLastRowAmount(newAmount: number): void {
    this.sheet.getRange(this.getLastRow(), SHEET_COLUMNS.AMOUNT_FINAL + 1).setValue(newAmount);
  }

  updateLastRowItems(newItems: string): void {
    this.sheet.getRange(this.getLastRow(), SHEET_COLUMNS.ITEMS + 1).setValue(newItems);
  }

  updateLastRowSender(newSender: string): void {
    this.sheet.getRange(this.getLastRow(), SHEET_COLUMNS.SENDER + 1).setValue(newSender);
  }

  deleteLastRow(): void {
    const lastRow = this.sheet.getLastRow();
    if (lastRow > 1) {
      this.sheet.deleteRow(lastRow);
    }
  }

  appendRow(data: any[]): void {
    this.sheet.appendRow(data);
  }

  getAllData(): any[][] {
    return this.sheet.getDataRange().getValues();
  }

  isDuplicate(date: Date, amount: number): boolean {
    return this.getAllData().some((row, index) => {
      if (index === 0) return false;
      const rowDate = row[SHEET_COLUMNS.DATE];
      return row[SHEET_COLUMNS.AMOUNT_FINAL] === amount &&
             rowDate instanceof Date && this.isSameDay(rowDate, date);
    });
  }

  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  getLastRow(): number {
    return this.sheet.getLastRow();
  }
}

// ==========================================
// ビジネスロジック層（計算・判定）
// ==========================================

interface DeleteResult {
  priceToRemove: number;
  found: boolean;
  alreadyDeleted: boolean;
}

/**
 * 削除対象の金額を計算する（商品直下割引・全体割引対応）
 * 
 * 対応するパターン:
 * 1) 商品直下割引:
 *    1. 商品A (1000円)
 *    ▲値引 (-200円)
 *    削除金額 = 1000 - 200 = 800円
 * 
 * 2) 全体割引（小計割引など）:
 *    1. 商品A (1000円)
 *    2. 商品B (1000円)
 *    小計: 2000円
 *    ▲割引 (-200円)
 *    削除金額 = 1000 - (1000/2000 * 200) = 1000 - 100 = 900円
 */
export function calculateDeleteAmount(itemsList: string, targetNumber: string): DeleteResult {
  // 二重削除チェック
  if (itemsList.includes(`${targetNumber}番削除`)) {
    return { priceToRemove: 0, found: false, alreadyDeleted: true };
  }

  // 最初に対象リスト全体を半角化しておくことで、ループ内での重複処理を避ける
  const lines = convertFullwidthToHalfwidth(itemsList).split('\n');
  let regularPrice = 0;
  let targetLineIndex = -1;
  let localDiscount = 0; // 商品直下の割引

  // Step 1: 対象商品を探す
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith(targetNumber)) {
      targetLineIndex = i;
      const prices = line.match(/[0-9,]{2,}/g);
      if (!prices) {
        return { priceToRemove: 0, found: false, alreadyDeleted: false };
      }
      regularPrice = parseInt(prices[prices.length - 1].replace(/,/g, ''));

      // Step 2: 直後の行をチェック（商品直下の割引）
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const discountKeywords = ['値引', '割引', '▲'];
        const hasDiscount = discountKeywords.some(keyword => nextLine.includes(keyword)) || 
                           nextLine.trim().startsWith('-');

        if (hasDiscount) {
          const discountPrices = nextLine.match(/[0-9,]+/g);
          if (discountPrices) {
            localDiscount = parseInt(discountPrices[0].replace(/,/g, ''));
          }
          // 商品直下割引があれば、それを使用
          return { priceToRemove: regularPrice - localDiscount, found: true, alreadyDeleted: false };
        }
      }
      break;
    }
  }

  if (targetLineIndex === -1) {
    return { priceToRemove: 0, found: false, alreadyDeleted: false };
  }

  // Step 3: 商品直下に割引がない場合、全体の小計割引をチェック
  let subtotalAmount = 0;
  let globalDiscount = 0;
  
  for (let i = targetLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // 「小計」「合計」「総計」などのキーワードから小計を抽出
    if ((line.includes('小計') || line.includes('合計') || line.includes('総計')) 
        && !line.includes('割引')) {
      const prices = line.match(/[0-9,]+/g);
      if (prices) {
        subtotalAmount = parseInt(prices[prices.length - 1].replace(/,/g, ''));
      }
    }

    // 「割引」「値引」「クーポン」などのキーワードから割引額を抽出
    const discountKeywords = ['値引', '割引', 'クーポン', 'ポイント'];
    const hasDiscount = discountKeywords.some(keyword => line.includes(keyword));
    if (hasDiscount) {
      const prices = line.match(/[0-9,]+/g);
      if (prices) {
        globalDiscount = parseInt(prices[prices.length - 1].replace(/,/g, ''));
      }
    }
  }

  // 全体割引がある場合、割引を按分して計算
  let appliedDiscount = 0;
  if (subtotalAmount > 0 && globalDiscount > 0) {
    const discountRate = globalDiscount / subtotalAmount;
    appliedDiscount = Math.round(regularPrice * discountRate);
  }

  // 最終的な削除金額
  const actualPrice = regularPrice - appliedDiscount;
  return { priceToRemove: actualPrice, found: true, alreadyDeleted: false };
}

interface AggregationResult {
  monthHusband: number;
  monthWife: number;
  totalHusband: number;
  totalWife: number;
  thisMonth: string;
}

/**
 * 集計データを計算する
 */
export function calculateAggregation(data: any[][]): AggregationResult {
  const now = new Date();
  const thisMonthYear = now.getFullYear();
  const thisMonthNum = now.getMonth() + 1;
  const thisMonth = `${thisMonthYear}/${String(thisMonthNum).padStart(2, '0')}`;

  let monthHusband = 0;
  let monthWife = 0;
  let totalHusband = 0;
  let totalWife = 0;

  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][SHEET_COLUMNS.DATE];
    const sender = data[i][SHEET_COLUMNS.SENDER];
    const amount = data[i][SHEET_COLUMNS.AMOUNT_FINAL];

    if (!(rowDate instanceof Date)) continue;

    if (sender === config.HUSBAND_NAME) {
      totalHusband += amount;
    } else if (sender === config.WIFE_NAME) {
      totalWife += amount;
    }

    const rowYear = rowDate.getFullYear();
    const rowMonth = rowDate.getMonth() + 1;
    const rowMonthStr = `${rowYear}/${String(rowMonth).padStart(2, '0')}`;
    
    if (rowMonthStr === thisMonth) {
      if (sender === config.HUSBAND_NAME) {
        monthHusband += amount;
      } else if (sender === config.WIFE_NAME) {
        monthWife += amount;
      }
    }
  }

  return { monthHusband, monthWife, totalHusband, totalWife, thisMonth };
}

interface CancelResult {
  success: boolean;
  targetNumber?: string;
  priceToRestore?: number;
}

/**
 * キャンセル情報を抽出する
 */
export function extractCancelInfo(itemsList: string): CancelResult {
  const lastDeleteMatch = itemsList.match(/>>\s*([0-9]+)番削除\(-([0-9,]+)円\)$/);

  if (lastDeleteMatch) {
    return {
      success: true,
      targetNumber: lastDeleteMatch[1],
      priceToRestore: parseInt(lastDeleteMatch[2].replace(/,/g, ''))
    };
  }

  return { success: false };
}

/**
 * 削除履歴を除去する
 */
export function removeDeleteHistory(itemsList: string): string {
  return itemsList.replace(/\n>>\s*[0-9]+番削除\(-[0-9,]+円\)$/, '');
}

// ==========================================
// ユーティリティ関数（テスト可能）
// ==========================================

/**
 * ユーザーIDからユーザー名を取得する
 */
export function getUserName(userId: string): string {
  if (userId === config.ID_HUSBAND) return config.HUSBAND_NAME;
  if (userId === config.ID_WIFE) return config.WIFE_NAME;
  return userId;
}

/**
 * 全角数字を半角数字に変換する
 */
export function convertFullwidthToHalfwidth(text: string): string {
  return text.replace(/[０-９]/g, function(s: string): string {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
}

/**
 * 金額から金額文字列を抽出して数値に変換する
 */
export function extractAmount(text: string): number {
  // 全角数字を半角に変換してから抽出
  const converted = convertFullwidthToHalfwidth(text);
  const match = converted.match(/[0-9]+/);
  return match ? parseInt(match[0]) : 0;
}

/**
 * テキストからメモ部分を抽出する（例：「150円 コンビニ」→「コンビニ」）
 */
export function extractMemo(text: string): string {
  // 全角数字を半角に変換してから処理
  const converted = convertFullwidthToHalfwidth(text);
  return converted.replace(/[0-9]+円/, "").trim();
}

// ==========================================
// ハンドラー関数（テスト可能）
// ==========================================

/**
 * 画像メッセージ（レシート）を処理する
 */
export function handleImageMessage(event: LineEvent, replyToken: string, senderName: string): void {
  try {
    const messageId: string = event.message.id || '';
    const imageBlob: GoogleAppsScript.Base.Blob = getLineImage(messageId);
    
    const result: ReceiptData | null = analyzeReceiptWithGemini(imageBlob);
    
    if (result) {
      saveToSheet(senderName, result);
      
      const resMsg: string = `【レシート記録完了】✓\n` +
                     `合計額: ${result.total.toLocaleString()}円\n` +
                     `------------------\n` +
                     `【品目リスト】\n${result.items}\n\n` +
                     `※「1を削除」のように送ると、その金額を引きます。`;
      sendLineMessage(replyToken, resMsg);
    }
  } catch (err) {
    sendLineMessage(replyToken, "エラー: " + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * テキストメッセージを処理する
 */
export function handleTextMessage(event: LineEvent, replyToken: string, senderName: string): void {
  const userText: string = event.message.text || '';
  
  if (userText.includes("削除") || userText.includes("除外")) {
    handleDeleteRequest(userText, replyToken);
  } else if (userText.includes("集計") || userText.includes("合計")) {
    handleAggregation(replyToken);
  } else if (userText.includes("キャンセル") || userText.includes("取り消し")) {
    handleCancel(replyToken);
  } else if (userText.includes("変更")) {
    handleChangeUser(userText, replyToken);
  } else if (userText.match(/[0-9０-９]+円/)) {
    handleManualEntry(userText, replyToken, senderName);
  } else if (userText.includes("レシート消して") || userText.includes("今のなし") || userText.includes("いまのなし") || userText.includes("データ削除")) {
    handleDataDeletion(replyToken);
  } else if (userText.includes("使い方") || userText.includes("ヘルプ") || userText.includes("オプション")) {
    handleHelp(replyToken);
  }
}

/**
 * 削除リクエストを処理する
 */
export function handleDeleteRequest(userText: string, replyToken: string): void {
  try {
    const numMatch = userText.match(/[0-9０-９]+/);
    if (!numMatch) return;

    const targetNumber = convertFullwidthToHalfwidth(numMatch[0]);
    const repo = new SheetRepository(config.SHEET_NAME);
    const rowData = repo.getLastRowData();

    const currentTotal = rowData[SHEET_COLUMNS.AMOUNT_FINAL];
    const itemsList = rowData[SHEET_COLUMNS.ITEMS];

    const result = calculateDeleteAmount(itemsList, targetNumber);

    if (result.alreadyDeleted) {
      sendLineMessage(replyToken, `【注意】\n${targetNumber}番はすでに削除済みです。二重減算は行いません。`);
      return;
    }

    if (result.found && result.priceToRemove > 0) {
      const newTotal = currentTotal - result.priceToRemove;
      repo.updateLastRowAmount(newTotal);
      repo.updateLastRowItems(itemsList + `\n>> ${targetNumber}番削除(-${result.priceToRemove}円)`);

      sendLineMessage(replyToken, `【修正完了】\n${targetNumber}番（${result.priceToRemove}円）を除外しました。\n現在の折半対象: ${newTotal.toLocaleString()}円`);
    } else {
      sendLineMessage(replyToken, `${targetNumber}番の金額を特定できませんでした。`);
    }
  } catch (err) {
    sendLineMessage(replyToken, 'エラー: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * 集計リクエストを処理する
 */
export function handleAggregation(replyToken: string): void {
  try {
    const repo = new SheetRepository(config.SHEET_NAME);
    const data = repo.getAllData();
    const agg = calculateAggregation(data);

    const resMsg = `【家計集計レポート】\n\n` +
      `📅 ${agg.thisMonth}月の集計\n` +
      `・${config.HUSBAND_NAME}: ${agg.monthHusband.toLocaleString()}円\n` +
      `・${config.WIFE_NAME}: ${agg.monthWife.toLocaleString()}円\n` +
      `・二人合計: ${(agg.monthHusband + agg.monthWife).toLocaleString()}円\n\n` +
      `💰 全期間累計\n` +
      `・${config.HUSBAND_NAME}: ${agg.totalHusband.toLocaleString()}円\n` +
      `・${config.WIFE_NAME}: ${agg.totalWife.toLocaleString()}円\n` +
      `・総計: ${(agg.totalHusband + agg.totalWife).toLocaleString()}円\n` +
      `・一人あたり: ${Math.floor((agg.totalHusband + agg.totalWife) / 2).toLocaleString()}円\n\n` +
      `※「いまのなし」等での削除反映済み`;

    sendLineMessage(replyToken, resMsg);
  } catch (err) {
    sendLineMessage(replyToken, 'エラー: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * キャンセルリクエストを処理する
 */
export function handleCancel(replyToken: string): void {
  try {
    const repo = new SheetRepository(config.SHEET_NAME);
    const rowData = repo.getLastRowData();

    const currentTotal = rowData[SHEET_COLUMNS.AMOUNT_FINAL];
    const itemsList = rowData[SHEET_COLUMNS.ITEMS];

    const cancelInfo = extractCancelInfo(itemsList);

    if (cancelInfo.success && cancelInfo.targetNumber && cancelInfo.priceToRestore) {
      const newTotal = currentTotal + cancelInfo.priceToRestore;
      repo.updateLastRowAmount(newTotal);
      repo.updateLastRowItems(removeDeleteHistory(itemsList));

      sendLineMessage(replyToken, `【キャンセル完了】\n${cancelInfo.targetNumber}番（${cancelInfo.priceToRestore}円）の削除を取り消しました。\n現在の合計: ${newTotal.toLocaleString()}円`);
    } else {
      sendLineMessage(replyToken, '取り消せる削除履歴が見つかりませんでした。');
    }
  } catch (err) {
    sendLineMessage(replyToken, 'エラー: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * ユーザー変更リクエストを処理する
 */
export function handleChangeUser(userText: string, replyToken: string): void {
  try {
    let newSender = '';
    if (userText.includes(config.WIFE_NAME) || userText.includes('妻')) {
      newSender = config.WIFE_NAME;
    } else if (userText.includes(config.HUSBAND_NAME) || userText.includes('夫')) {
      newSender = config.HUSBAND_NAME;
    }

    if (newSender !== '') {
      const repo = new SheetRepository(config.SHEET_NAME);
      repo.updateLastRowSender(newSender);
      sendLineMessage(replyToken, `【変更完了】\n投稿者を「${newSender}」に変更しました。`);
    } else {
      sendLineMessage(replyToken, '誰に変更するか指定してください（例：' + config.WIFE_NAME + 'に変更）');
    }
  } catch (err) {
    sendLineMessage(replyToken, 'エラー: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * 手入力リクエストを処理する
 */
export function handleManualEntry(userText: string, replyToken: string, senderName: string): void {
  try {
    const amount = extractAmount(userText);
    const memo = extractMemo(userText);

    const repo = new SheetRepository(config.SHEET_NAME);
    const today = new Date();
    
    // 重複チェック
    if (repo.isDuplicate(today, amount)) {
      sendLineMessage(replyToken, `【重複登録の可能性があります】\n本日${amount}円の登録が既にあります。\n重複していないか確認してください。`);
      return;
    }

    repo.appendRow([today, senderName, amount, amount, '手入力', memo]);

    sendLineMessage(replyToken, `【手入力完了】\n${senderName}：${amount}円（${memo}）`);
  } catch (err) {
    sendLineMessage(replyToken, 'エラー: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * データ削除リクエストを処理する
 */
export function handleDataDeletion(replyToken: string): void {
  try {
    const repo = new SheetRepository(config.SHEET_NAME);
    const lastRow = repo.getLastRow();

    if (lastRow <= 1) {
      sendLineMessage(replyToken, '削除できるデータがありません。');
      return;
    }

    const rowData = repo.getLastRowData();
    const dateStr = Utilities.formatDate(rowData[SHEET_COLUMNS.DATE], 'JST', 'MM/dd');
    const amount = rowData[SHEET_COLUMNS.AMOUNT_FINAL];

    repo.deleteLastRow();

    sendLineMessage(replyToken, `【データ破棄完了】\n直前のレシートデータ（${dateStr}の${amount}円）を削除しました。`);
  } catch (err) {
    sendLineMessage(replyToken, 'エラー: ' + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * ヘルプメッセージを送信する
 */
export function handleHelp(replyToken: string): void {
  const helpMsg: string = `【家計簿Bot 使い方ガイド】

📸 記録する
・レシートの写真を送るだけ！自動で日付・合計・品目を読み取ります。

金額を調整する
・「1を削除」または「1を除外」… 特定の番号の金額を除外します。
・「キャンセル」… 直前の削除を取り消します。

間違いを直す
・「${config.WIFE_NAME}に変更」… 投稿者を切り替えます。
・「今のなし」… 直前のレシート登録を完全に消去します。

📊 確認する
・「集計」または「合計」… 今月とここまでの二人の支払い状況を表示します。

✏️ その他
・「150円 コンビニ」… レシートがない時の手入力も可能です。`;

  sendLineMessage(replyToken, helpMsg);
}

function doPost(e: GoogleAppsScript.Events.DoPost): void {
  // ログを出力しておく（あとで確認できるようにする）
  console.log(e.postData.contents); 

  const json = JSON.parse(e.postData.contents);
  const event = json.events[0];
  
  if (!event) return;

  const replyToken: string = event.replyToken;
  const userId: string = event.source.userId;
  const senderName: string = getUserName(userId);

  if (event.message.type === 'image') {
    handleImageMessage(event, replyToken, senderName);
  } else if (event.message.type === 'text') {
    handleTextMessage(event, replyToken, senderName);
  }
}

function analyzeReceiptWithGemini(blob: GoogleAppsScript.Base.Blob): ReceiptData | null {
  const url: string = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${config.GEMINI_API_KEY}`;
  
  // 指示を極限までシンプルに
  const prompt: string = "レシートの内容を解析してください。必ず「合計：〇〇円」という行と、「1.品目(金額)」という形式のリストを含めて回答してください。また、日付と時刻も「日付：YYYY/MM/DD 時刻：HH:MM」の形式で含めてください。";
  
  // 画像データを確実に変換
  const base64Data: string = Utilities.base64Encode(blob.getBytes());
  
  const payload: object = {
    "contents": [{
      "parts": [
        { "text": prompt },
        { "inline_data": { "mime_type": "image/jpeg", "data": base64Data } }
      ]
    }]
  };

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response: GoogleAppsScript.URL_Fetch.HTTPResponse = UrlFetchApp.fetch(url, options);
  const resText: string = response.getContentText();
  const json: GeminiResponse = JSON.parse(resText);

  // エラー原因をLINEに詳しく出すための処理
  if (json.error) {
    throw new Error("Gemini API Error: " + json.error.message);
  }
  
  if (!json.candidates || !json.candidates[0].content) {
    throw new Error("AIが内容を理解できませんでした。レスポンス: " + resText.substring(0, 100));
  }

  const resultText: string = json.candidates[0].content.parts[0].text;
  
  const dateMatch: RegExpMatchArray | null = resultText.match(/日付[:：]\s*(\d{4}[/-年]\d{1,2}[/-月]\d{1,2})/);
  const timeMatch: RegExpMatchArray | null = resultText.match(/時刻[:：]\s*(\d{1,2}:\d{2})/);
  let receiptDate: Date = new Date(); // デフォルトは今日
  if (dateMatch) {
    // 文字列をGASが扱える日付形式に変換
    const dateStr: string = dateMatch[1].replace(/[年月]/g, '/').replace(/日/g, '');
    receiptDate = new Date(dateStr);
  }
  if (timeMatch) {
    const [hour, minute] = timeMatch[1].split(':').map(Number);
    receiptDate.setHours(hour, minute, 0, 0);
  }

  // 合計金額を抽出
  const totalMatch: RegExpMatchArray | null = resultText.match(/合計[:：]\s*([0-9,]+)/) || resultText.match(/([0-9,]+)\s*円/);
  const total: number = totalMatch ? parseInt(totalMatch[1].replace(/,/g, "")) : 0;

  return {
    date: receiptDate,
    total: total,
    items: resultText
  };
}

function getLineImage(messageId: string): GoogleAppsScript.Base.Blob {
  const url: string = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = { "headers": { "Authorization": `Bearer ${config.LINE_TOKEN}` } };
  return UrlFetchApp.fetch(url, options).getBlob();
}

// ★修正：スプレッドシートの列構成を変更
function saveToSheet(user: string, data: ReceiptData): void {
  const repo = new SheetRepository(config.SHEET_NAME);
  if (repo.isDuplicate(data.date, data.total)) {
    throw new Error(`重複登録: ${Utilities.formatDate(data.date, 'JST', 'MM/dd')}の${data.total}円の登録が既に存在します。`);
  }

  repo.appendRow([
    data.date,  // A列: レシートの日付
    user,       // B列
    data.total, // C列
    data.total, // D列
    data.items, // E列
    ""          // F列
  ]);
}

function sendLineMessage(replyToken: string, text: string): void {
  const url: string = "https://api.line.me/v2/bot/message/reply";
  const payload: object = { "replyToken": replyToken, "messages": [{"type": "text", "text": text}] };
  UrlFetchApp.fetch(url, { "method": "post", "headers": { "Content-Type": "application/json", "Authorization": `Bearer ${config.LINE_TOKEN}` }, "payload": JSON.stringify(payload) });
}
