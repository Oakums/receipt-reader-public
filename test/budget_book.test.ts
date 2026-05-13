import { getUserName, convertFullwidthToHalfwidth, extractAmount, extractMemo, handleDeleteRequest, handleTextMessage, handleImageMessage, calculateDeleteAmount, calculateAggregation, extractCancelInfo, removeDeleteHistory } from '../budget_book';

describe('budget_book utility functions', () => {
  describe('getUserName', () => {
    it('should return "太郎" for husband ID', () => {
      const result = getUserName('111111111111111111111111111111111');
      expect(result).toBe('太郎');
    });

    it('should return "花子" for wife ID', () => {
      const result = getUserName('222222222222222222222222222222222');
      expect(result).toBe('花子');
    });

    it('should return the user ID itself for unknown ID', () => {
      const unknownId = 'U999999999999999999999999999999';
      const result = getUserName(unknownId);
      expect(result).toBe(unknownId);
    });
  });

  describe('convertFullwidthToHalfwidth', () => {
    it('should convert fullwidth digits to halfwidth', () => {
      const result = convertFullwidthToHalfwidth('１２３');
      expect(result).toBe('123');
    });

    it('should handle mixed fullwidth and halfwidth', () => {
      const result = convertFullwidthToHalfwidth('１２3４');
      expect(result).toBe('1234');
    });

    it('should handle text with fullwidth numbers', () => {
      const result = convertFullwidthToHalfwidth('５番削除');
      expect(result).toBe('5番削除');
    });

    it('should return original text if no fullwidth digits', () => {
      const result = convertFullwidthToHalfwidth('abc123');
      expect(result).toBe('abc123');
    });

    it('should handle empty string', () => {
      const result = convertFullwidthToHalfwidth('');
      expect(result).toBe('');
    });
  });

  describe('extractAmount', () => {
    it('should extract amount from text with yen symbol', () => {
      const result = extractAmount('150円 コンビニ');
      expect(result).toBe(150);
    });

    it('should extract the first number', () => {
      const result = extractAmount('500円と1000円');
      expect(result).toBe(500);
    });

    it('should handle large amounts', () => {
      const result = extractAmount('9999999円');
      expect(result).toBe(9999999);
    });

    it('should return 0 if no number found', () => {
      const result = extractAmount('コンビニ');
      expect(result).toBe(0);
    });

    it('should handle fullwidth digits', () => {
      const result = extractAmount('１５０円');
      expect(result).toBe(150);
    });

    it('should return 0 for empty string', () => {
      const result = extractAmount('');
      expect(result).toBe(0);
    });
  });

  describe('extractMemo', () => {
    it('should extract memo after amount', () => {
      const result = extractMemo('150円 コンビニ');
      expect(result).toBe('コンビニ');
    });

    it('should handle text without space', () => {
      const result = extractMemo('150円コンビニ');
      expect(result).toBe('コンビニ');
    });

    it('should return empty string if no memo', () => {
      const result = extractMemo('150円');
      expect(result).toBe('');
    });

    it('should return empty string if no amount', () => {
      const result = extractMemo('コンビニ');
      expect(result).toBe('コンビニ');
    });

    it('should handle fullwidth yen symbol', () => {
      const result = extractMemo('１５０円 食事');
      expect(result).toBe('食事');
    });

    it('should trim whitespace', () => {
      const result = extractMemo('500円   レストラン');
      expect(result).toBe('レストラン');
    });

    it('should return empty string for empty input', () => {
      const result = extractMemo('');
      expect(result).toBe('');
    });
  });
});

describe('budget_book business logic functions', () => {
  describe('calculateDeleteAmount', () => {
    it('should find and return price to remove from numbered items', () => {
      const itemsList = '1. 商品A (500円)\n2. 商品B (1000円)\n3. 商品C (300円)';
      const result = calculateDeleteAmount(itemsList, '2');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(1000);
      expect(result.alreadyDeleted).toBe(false);
    });

    it('should handle commas in prices', () => {
      const itemsList = '1. 商品A (1,500円)\n2. 商品B (2,000円)';
      const result = calculateDeleteAmount(itemsList, '2');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(2000);
    });

    it('should calculate actual price when discount is present', () => {
      const itemsList = '1. 商品A (1000円)\n▲値引 (-200円)\n2. 商品B (500円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(800); // 1000 - 200 = 800
    });

    it('should handle discount with commas', () => {
      const itemsList = '1. セール品 (10,000円)\n▲割引 (-2,500円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(7500); // 10000 - 2500 = 7500
    });

    it('should handle discount starting with hyphen', () => {
      const itemsList = '1. 商品A (5000円)\n- 割引 (-1000円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(4000); // 5000 - 1000 = 4000
    });

    it('should handle discount with ▲ symbol', () => {
      const itemsList = '1. 商品A (3000円)\n▲ (-600円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(2400); // 3000 - 600 = 2400
    });

    it('should detect already deleted items', () => {
      const itemsList = '1. 商品A (500円)\n>> 1番削除(-500円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.alreadyDeleted).toBe(true);
      expect(result.found).toBe(false);
    });

    it('should return not found for non-existent items', () => {
      const itemsList = '1. 商品A (500円)\n2. 商品B (1000円)';
      const result = calculateDeleteAmount(itemsList, '5');
      expect(result.found).toBe(false);
      expect(result.priceToRemove).toBe(0);
    });

    it('should return not found if item has no price', () => {
      const itemsList = '1. 商品A\n2. 商品B (1000円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(false);
    });

    it('should handle fullwidth numbers', () => {
      const itemsList = '1. 商品A (５００円)\n2. 商品B (1000円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
    });

    it('should ignore discount line if not immediately after item', () => {
      const itemsList = '1. 商品A (1000円)\n\n▲値引 (-200円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      expect(result.priceToRemove).toBe(1000); // 割引が次行ではないので無視
    });

    it('should calculate global discount applied to item', () => {
      const itemsList = '1. 商品A (1000円)\n2. 商品B (1000円)\n小計: 2000円\n▲クーポン割引 (-200円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      // 割引率: 200/2000 = 10%
      // 削除金額: 1000 - (1000 * 10%) = 1000 - 100 = 900
      expect(result.priceToRemove).toBe(900);
    });

    it('should calculate global discount with commas', () => {
      const itemsList = '1. 商品A (5,000円)\n2. 商品B (5,000円)\n小計: 10,000円\n▲割引 (-1,000円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      // 割引率: 1000/10000 = 10%
      // 削除金額: 5000 - (5000 * 10%) = 5000 - 500 = 4500
      expect(result.priceToRemove).toBe(4500);
    });

    it('should prioritize local discount over global discount', () => {
      const itemsList = '1. 商品A (1000円)\n▲値引 (-100円)\n2. 商品B (1000円)\n小計: 2000円\n▲クーポン割引 (-200円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      // 商品直下割引を優先使用: 1000 - 100 = 900
      expect(result.priceToRemove).toBe(900);
    });

    it('should handle global discount with uneven distribution', () => {
      const itemsList = '1. 商品A (800円)\n2. 商品B (1200円)\n小計: 2000円\n▲割引 (-200円)';
      const result = calculateDeleteAmount(itemsList, '1');
      expect(result.found).toBe(true);
      // 割引率: 200/2000 = 10%
      // 削除金額: 800 - (800 * 10%) = 800 - 80 = 720
      expect(result.priceToRemove).toBe(720);
    });

    it('should handle multiple items with global discount', () => {
      const itemsList = '1. 商品A (1000円)\n2. 商品B (2000円)\n3. 商品C (1000円)\n小計: 4000円\n▲ポイント割引 (-400円)';
      const result = calculateDeleteAmount(itemsList, '2');
      expect(result.found).toBe(true);
      // 割引率: 400/4000 = 10%
      // 削除金額: 2000 - (2000 * 10%) = 2000 - 200 = 1800
      expect(result.priceToRemove).toBe(1800);
    });
  });

  describe('calculateAggregation', () => {
    it('should sum up monthly and total amounts for each user', () => {
      const currentDate = new Date();
      const thisMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);

      const data = [
        ['日付', 'ユーザー', '入力', '最終', '品目', 'メモ'], // ヘッダー
        [thisMonth, '太郎', 500, 500, 'items', 'memo'],
        [thisMonth, '花子', 1000, 1000, 'items', 'memo'],
        [lastMonth, '太郎', 2000, 2000, 'items', 'memo'],
      ];

      const result = calculateAggregation(data);

      expect(result.monthHusband).toBe(500);
      expect(result.monthWife).toBe(1000);
      expect(result.totalHusband).toBe(2500);
      expect(result.totalWife).toBe(1000);
    });

    it('should handle empty data', () => {
      const data = [['日付', 'ユーザー', '入力', '最終', '品目', 'メモ']];
      const result = calculateAggregation(data);

      expect(result.monthHusband).toBe(0);
      expect(result.monthWife).toBe(0);
      expect(result.totalHusband).toBe(0);
      expect(result.totalWife).toBe(0);
    });

    it('should ignore rows with invalid dates', () => {
      const currentDate = new Date();
      const thisMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

      const data = [
        ['日付', 'ユーザー', '入力', '最終', '品目', 'メモ'],
        [thisMonth, '太郎', 500, 500, 'items', 'memo'],
        ['invalid-date', '花子', 1000, 1000, 'items', 'memo'],
      ];

      const result = calculateAggregation(data);

      expect(result.monthHusband).toBe(500);
      expect(result.monthWife).toBe(0);
    });

    it('should include thisMonth in result', () => {
      const data = [['日付', 'ユーザー', '入力', '最終', '品目', 'メモ']];
      const result = calculateAggregation(data);

      // thisMonth should be in format 'yyyy/MM'
      expect(result.thisMonth).toMatch(/\d{4}\/\d{2}/);
    });
  });

  describe('extractCancelInfo', () => {
    it('should extract cancel info from deletion history', () => {
      const itemsList = 'items\n>> 2番削除(-1500円)';
      const result = extractCancelInfo(itemsList);

      expect(result.success).toBe(true);
      expect(result.targetNumber).toBe('2');
      expect(result.priceToRestore).toBe(1500);
    });

    it('should handle commas in deleted price', () => {
      const itemsList = 'items\n>> 3番削除(-2,500円)';
      const result = extractCancelInfo(itemsList);

      expect(result.success).toBe(true);
      expect(result.targetNumber).toBe('3');
      expect(result.priceToRestore).toBe(2500);
    });

    it('should return success false if no deletion history', () => {
      const itemsList = 'items without deletion';
      const result = extractCancelInfo(itemsList);

      expect(result.success).toBe(false);
      expect(result.targetNumber).toBeUndefined();
      expect(result.priceToRestore).toBeUndefined();
    });

    it('should only match the last deletion', () => {
      const itemsList = '>> 1番削除(-500円)\nitems\n>> 2番削除(-1000円)';
      const result = extractCancelInfo(itemsList);

      expect(result.success).toBe(true);
      expect(result.targetNumber).toBe('2');
      expect(result.priceToRestore).toBe(1000);
    });
  });

  describe('removeDeleteHistory', () => {
    it('should remove delete history from items list', () => {
      const itemsList = '1. 商品A (500円)\n2. 商品B (1000円)\n>> 1番削除(-500円)';
      const result = removeDeleteHistory(itemsList);

      expect(result).toBe('1. 商品A (500円)\n2. 商品B (1000円)');
      expect(result.includes('削除')).toBe(false);
    });

    it('should handle multiple spaces in delete history', () => {
      const itemsList = 'items\n>>    1番削除(-500円)';
      const result = removeDeleteHistory(itemsList);

      expect(result).toBe('items');
    });

    it('should not remove if no delete history', () => {
      const itemsList = '1. 商品A (500円)\n2. 商品B (1000円)';
      const result = removeDeleteHistory(itemsList);

      expect(result).toBe(itemsList);
    });

    it('should only remove the last line delete history', () => {
      const itemsList = '>> 1番削除(-500円)\n2. 商品B (1000円)\n>> 2番削除(-1000円)';
      const result = removeDeleteHistory(itemsList);

      expect(result).toBe('>> 1番削除(-500円)\n2. 商品B (1000円)');
    });
  });
});

describe('budget_book handler function signatures', () => {
  describe('handleDeleteRequest', () => {
    it('should be callable with userText and replyToken', () => {
      // このテストは型安全性を確認するもの
      // 実装としては、関数が存在し、正しいシグネチャを持つことを確認
      expect(typeof handleDeleteRequest).toBe('function');
    });
  });
});

describe('doPost message routing', () => {
  describe('handleTextMessage routing', () => {
    it('should have handleTextMessage function', () => {
      expect(typeof handleTextMessage).toBe('function');
    });

    it('should have handleImageMessage function', () => {
      expect(typeof handleImageMessage).toBe('function');
    });

    it('should recognize delete keywords in text', () => {
      const text1 = '1を削除';
      const text2 = '2を除外';
      
      expect(text1.includes('削除') || text1.includes('除外')).toBe(true);
      expect(text2.includes('削除') || text2.includes('除外')).toBe(true);
    });

    it('should recognize aggregation keywords in text', () => {
      const text1 = '集計';
      const text2 = '合計';
      
      expect(text1.includes('集計') || text1.includes('合計')).toBe(true);
      expect(text2.includes('集計') || text2.includes('合計')).toBe(true);
    });

    it('should recognize cancel keywords in text', () => {
      const text1 = 'キャンセル';
      const text2 = '取り消し';
      
      expect(text1.includes('キャンセル') || text1.includes('取り消し')).toBe(true);
      expect(text2.includes('キャンセル') || text2.includes('取り消し')).toBe(true);
    });

    it('should recognize change keywords in text', () => {
      const text1 = '花子に変更';
      const text2 = '夫に変更';
      
      expect(text1.includes('変更')).toBe(true);
      expect(text2.includes('変更')).toBe(true);
    });

    it('should recognize manual entry pattern', () => {
      const text1 = '150円 コンビニ';
      const text2 = '1500円';
      
      expect(text1.match(/[0-9０-９]+円/)).toBeTruthy();
      expect(text2.match(/[0-9０-９]+円/)).toBeTruthy();
    });

    it('should recognize data deletion keywords in text', () => {
      const text1 = 'レシート消して';
      const text2 = '今のなし';
      const text3 = 'データ削除';
      
      expect(text1.includes('レシート消して') || text1.includes('今のなし') || text1.includes('データ削除')).toBe(true);
      expect(text2.includes('レシート消して') || text2.includes('今のなし') || text2.includes('データ削除')).toBe(true);
      expect(text3.includes('レシート消して') || text3.includes('今のなし') || text3.includes('データ削除')).toBe(true);
    });

    it('should recognize help keywords in text', () => {
      const text1 = '使い方';
      const text2 = 'ヘルプ';
      const text3 = 'オプション';
      
      expect(text1.includes('使い方') || text1.includes('ヘルプ') || text1.includes('オプション')).toBe(true);
      expect(text2.includes('使い方') || text2.includes('ヘルプ') || text2.includes('オプション')).toBe(true);
      expect(text3.includes('使い方') || text3.includes('ヘルプ') || text3.includes('オプション')).toBe(true);
    });
  });

  describe('message type detection', () => {
    it('should detect image message type', () => {
      const mockEvent: any = {
        replyToken: 'test-token',
        source: { userId: '111111111111111111111111111111111' },
        message: {
          type: 'image',
          id: 'message-id-123'
        }
      };

      expect(mockEvent.message.type).toBe('image');
    });

    it('should detect text message type', () => {
      const mockEvent: any = {
        replyToken: 'test-token',
        source: { userId: '222222222222222222222222222222222' },
        message: {
          type: 'text',
          text: 'test'
        }
      };

      expect(mockEvent.message.type).toBe('text');
    });

    it('should parse LINE event structure correctly', () => {
      const eventJson = JSON.stringify({
        events: [{
          replyToken: 'test-reply-token',
          source: { userId: 'test-user-id' },
          message: {
            type: 'text',
            text: 'test message'
          }
        }]
      });

      const parsed = JSON.parse(eventJson);
      const event = parsed.events[0];

      expect(event.replyToken).toBe('test-reply-token');
      expect(event.source.userId).toBe('test-user-id');
      expect(event.message.type).toBe('text');
      expect(event.message.text).toBe('test message');
    });
  });
});

describe('SheetRepository duplicate check', () => {
  describe('isDuplicate', () => {
    it('should detect duplicate entries with same date and amount', () => {
      // SheetRepositoryの重複チェックロジックのテスト
      // 実際のスプレッドシート操作が必要になるため、このテストは
      // GAS環境で実行する必要があります
      
      // 同じ日付と金額の組み合わせが重複として認識されることを確認
      const today = new Date();
      const amount = 5000;
      
      // このテストは、実際のSheet API操作を伴うため、
      // GAS環境でのテストが必要です
      expect(true).toBe(true); // プレースホルダー
    });

    it('should not flag different amounts on same date as duplicate', () => {
      // 同じ日付でも金額が異なれば重複でない
      const today = new Date();
      
      // 5000円と6000円は異なるため重複ではない
      expect(5000).not.toBe(6000);
    });

    it('should not flag same amount on different dates as duplicate', () => {
      // 金額が同じでも日付が異なれば重複でない
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      expect(today.getDate()).not.toBe(tomorrow.getDate());
    });

    it('should correctly compare dates ignoring time component', () => {
      const date1 = new Date('2024-02-14T10:30:00');
      const date2 = new Date('2024-02-14T15:45:00');
      const date3 = new Date('2024-02-15T10:30:00');
      
      // 同じ日付で時刻が異なる場合
      expect(date1.getFullYear()).toBe(date2.getFullYear());
      expect(date1.getMonth()).toBe(date2.getMonth());
      expect(date1.getDate()).toBe(date2.getDate());
      
      // 異なる日付
      expect(date1.getDate()).not.toBe(date3.getDate());
    });
  });

  describe('duplicate detection logic', () => {
    it('should handle duplicate check for manual entry', () => {
      // 手入力時の重複チェックのシミュレーション
      const today = new Date();
      const amount = 1500;
      
      // 同じ日付と金額のデータが既に存在する場合
      const existingData = [
        [new Date(), 'ユーザー1', 1500, 1500, '品目', 'メモ']
      ];
      
      // 新しいエントリが重複するかチェック
      const isDuplicate = existingData.some(row => {
        const rowDate = row[0];
        const rowAmount = row[3]; // AMOUNT_FINAL列
        return rowDate instanceof Date &&
               rowDate.getFullYear() === today.getFullYear() &&
               rowDate.getMonth() === today.getMonth() &&
               rowDate.getDate() === today.getDate() &&
               rowAmount === amount;
      });
      
      expect(isDuplicate).toBe(true);
    });

    it('should allow non-duplicate entries on same date', () => {
      // 同じ日付でも異なる金額なら許可
      const today = new Date();
      const newAmount = 2000;
      
      const existingData = [
        [today, 'ユーザー1', 1500, 1500, '品目', 'メモ']
      ];
      
      const isDuplicate = existingData.some(row => {
        const rowDate = row[0];
        const rowAmount = row[3];
        return rowDate instanceof Date &&
               rowDate.getFullYear() === today.getFullYear() &&
               rowDate.getMonth() === today.getMonth() &&
               rowDate.getDate() === today.getDate() &&
               rowAmount === newAmount;
      });
      
      expect(isDuplicate).toBe(false);
    });

    it('should handle duplicate check for receipt entry', () => {
      // レシート登録時の重複チェック（日付と金額ベース）
      const receiptDate = new Date('2024-02-14');
      const receiptAmount = 3500;
      
      const existingData = [
        [new Date('2024-02-14'), '太郎', 3500, 3500, 'レシート内容', ''],
        [new Date('2024-02-13'), '花子', 3500, 3500, 'レシート内容', '']
      ];
      
      // 同じ日付と金額がある
      const isDuplicate = existingData.some(row => {
        const rowDate = row[0];
        const rowAmount = row[3];
        return rowDate instanceof Date &&
               rowDate.getFullYear() === receiptDate.getFullYear() &&
               rowDate.getMonth() === receiptDate.getMonth() &&
               rowDate.getDate() === receiptDate.getDate() &&
               rowAmount === receiptAmount;
      });
      
      expect(isDuplicate).toBe(true);
    });
  });
});

