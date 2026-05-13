# レシート読み取り家計簿Bot

LINEでレシートの写真を送るだけで、AI（Gemini API）が内容を解析し、Googleスプレッドシートに家計簿を自動記録するBotです。共働き夫婦などの折半勘定を想定し、集計機能や特定の品目除外機能も備えています。

## アーキテクチャ

本システムは、完全サーバーレスな構成で実現されています。

### システム構成図

```text
[User] <---> [LINE Messaging API] <---> [Google Apps Script (GAS)]
                                             |         |
                                             |         v
                                             |    [Google Gemini API]
                                             v       (AI Analysis)
                                      [Google Sheets]
                                         (Database)
```

### 各コンポーネントの役割

- **LINE Messaging API**: ユーザーインターフェース。レシート画像の受信やコマンドの受け付け、ユーザーへの応答通知を担います。
- **Google Apps Script (GAS)**: システムの核となるバックエンドです。Webhookの受信、各APIのオーケストレーション、ビジネスロジックの実行を行います。
- **Google Gemini API (gemini-1.5-flash)**: 送信されたレシート画像の解析。高度なOCR機能に加え、非構造的なレシートデータから「日付」「合計金額」「品目リスト」を構造化データとして抽出します。
- **Google Sheets**: 永続化ストレージ。家計簿データ（日付、投稿者、金額、品目詳細）を保存し、集計の基盤となります。

### 主な処理フロー

1. **画像受信**: LINE Botが画像を受け取ると、GASの `doPost` 関数が起動します。
2. **AI解析**: GASがLINEのサーバーから画像バイナリを取得し、Gemini APIへ解析リクエストを投げます。
3. **データ保存**: 解析されたデータに基づき、重複チェックを行った後、Googleスプレッドシートの末尾に書き込みます。
4. **事後操作**: ユーザーが「1を削除」等のテキストを送ると、GASがスプレッドシート内の「品目リスト」を走査・計算し、合計金額を動的に更新します。

## 主な機能

- **レシート画像解析**: AIによる高精度なデータ抽出。
- **動的な金額修正**: レシート内の特定番号を指定して除外（酒類のみ除外したい場合などに便利）。
- **自動集計**: 「集計」と送るだけで、月間および累計の支払い状況（夫婦それぞれの負担額）を表示。
- **手入力対応**: 「150円 コンビニ」といったテキスト形式でのクイックな登録。
- **重複防止**: 同じ日付・金額の連続投稿を検知して警告。

## セットアップ方法

### 1. Googleスプレッドシートの準備

1. スプレッドシートを新規作成。
2. 「家計簿」という名前のシートを作成し、1行目にヘッダー（日付、投稿者、入力金額、最終金額、品目、備考）を設定。

### 2. ローカル開発環境の構築

1. リポジトリをクローンし、依存パッケージをインストールします。

   ```bash
   npm install
   ```

2. `clasp` で Google アカウントにログインします。

   ```bash
   npx clasp login
   ```

3. 既存の GAS プロジェクトと紐付けるか、新規作成します。

   ```bash
   npx clasp create --title "receipt-reader" --type webapp # 新規の場合
   # または .clasp.json に scriptId を設定
   ```

### 3. スクリプトプロパティの設定

Google Apps Script のプロジェクト設定から、以下のスクリプトプロパティを追加してください。

- `LINE_TOKEN`: LINE Developersで発行したチャネルアクセストークン
- `GEMINI_API_KEY`: Google AI Studioで発行したAPIキー
- `ID_HUSBAND` / `ID_WIFE`: 各ユーザーのLINEユーザーID
- `HUSBAND_NAME` / `WIFE_NAME`: 表示名（例：夫 / 妻）

### 4. GitHub Actions による自動デプロイ

`main` ブランチにプッシュすると、GitHub Actions が起動し、自動的に GAS へデプロイされます。事前にリポジトリの Settings > Secrets に以下を設定してください。

- `CLASP_CREDENTIALS`: `~/.clasprc.json` の内容を Base64 エンコードした文字列。
- `BOT_DEPLOY_ID`: デプロイ済みのウェブアプリの ID。

### 5. LINE Developersの設定

1. Messaging API設定の「Webhook URL」に、GASでデプロイしたウェブアプリのURLを入力。
2. 「Webhookの利用」を有効にする。

## 開発者向けガイド

### コマンド

コードの修正や品質管理のために以下のコマンドを使用します。

- **ビルド**: `npm run build`  
  TypeScriptソースをGoogle Apps Scriptで実行可能なJavaScript形式にコンパイルします。
- **デプロイ**: `npm run deploy`  
  `clasp` を使用して、ビルド済みのコードをGoogle Apps Scriptプロジェクトへ反映し、新しいバージョンとしてデプロイします。
- **テスト実行**: `npm test`  
  ロジック（金額計算や重複チェックなど）のユニットテストを実行し、意図しないバグの混入を防ぎます。

## 技術スタック

- 言語: TypeScript / Google Apps Script
- AI: Google Gemini 1.5 Flash API
- 外部連携: LINE Messaging API

## ライセンス

MIT License
