 
sequenceDiagram
    autonumber
    actor User as ユーザー (夫/妻)
    participant LINE as LINE Platform
    participant GAS as Google Apps Script (Main)
    participant Gemini as Gemini API (Flash 1.5)
    participant GSS as Google Sheets (DB)

    User->>LINE: レシート画像を送信
    LINE->>GAS: Webhook (画像ID)
    GAS->>LINE: 画像バイナリを取得
    GAS->>Gemini: 画像 + 解析プロンプトを送出
    Gemini->>Gemini: OCR & 構造化データ抽出
    Gemini-->>GAS: JSON (日付, 合計, 品目リスト)
    GAS->>GSS: 重複チェック & 行追加
    GSS-->>GAS: 書き込み完了
    GAS->>LINE: 登録完了通知 (リプライ)
    LINE-->>User: メッセージ受信
```