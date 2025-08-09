const SETTINGS = [
  {
    sheetName: "FMシアター",
    rssUrl: "https://www.nhk.jp/feed/bl/pWgypnnJeM/rss/rss.xml",
  },
  {
    sheetName: "青春アドベンチャー",
    rssUrl: "https://www.nhk.jp/feed/bl/pA1EPjlLrA/rss/rss.xml",
  },
];

const EMAIL_TO = "longposition+radio@gmail.com";

function checkRSSAndUpdateSheet() {
  Logger.log("========== RSSチェック処理 開始 ==========");
  SETTINGS.forEach((setting) => {
    Logger.log(`--- シート「${setting.sheetName}」の処理開始 ---`);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
      setting.sheetName
    );
    if (!sheet) {
      Logger.log(
        `エラー: シート「${setting.sheetName}」が見つかりません。処理スキップ`
      );
      return;
    }

    try {
      Logger.log(`RSS取得: ${setting.rssUrl}`);
      const feed = UrlFetchApp.fetch(setting.rssUrl).getContentText();
      const xml = XmlService.parse(feed);
      const root = xml.getRootElement();
      const channel = root.getChild("channel");
      const items = channel.getChildren("item");

      Logger.log(`取得アイテム数: ${items.length}`);

      const parsedItems = items
        .map((item) => {
          const titleFull = item.getChild("title").getText();
          const title = titleFull.match(/『(.+?)』/)?.[1] || titleFull;
          const rawMonthDayStr = extractDateFromTitle(
            titleFull,
            setting.sheetName
          );
          const date = parseDateConsideringYearCross(rawMonthDayStr);
          Logger.log(
            `  タイトル: "${title}" / 放送日: ${
              date ? formatDate(date) : "不明"
            }`
          );
          return { item, title, date };
        })
        .filter((x) => x.date !== null);

      // 日付昇順ソート
      parsedItems.sort((a, b) => a.date - b.date);

      // 既存タイトル取得
      const existingTitles = sheet
        .getRange("B2:B" + sheet.getLastRow())
        .getValues()
        .flat()
        .map((t) => (t || "").toString().trim())
        .filter((t) => t !== "");
      Logger.log(`既存タイトル数: ${existingTitles.length}`);

      // 追加対象フィルター
      const itemsToAdd = parsedItems.filter(
        ({ title }) => !existingTitles.includes(title.trim())
      );
      Logger.log(`追加予定アイテム数: ${itemsToAdd.length}`);

      if (itemsToAdd.length === 0) {
        Logger.log("新規追加なし");
        return;
      }

      // 既存最終行取得
      let lastRow = sheet.getLastRow();

      itemsToAdd.forEach(({ title, date }, idx) => {
        sheet.insertRowsAfter(lastRow, 1);
        const rangeToCopy = sheet.getRange(
          lastRow,
          1,
          1,
          sheet.getLastColumn()
        );
        rangeToCopy.copyTo(
          sheet.getRange(lastRow + 1, 1, 1, sheet.getLastColumn()),
          { contentsOnly: false }
        );

        sheet
          .getRange(lastRow + 1, 2)
          .clearContent()
          .setValue(title); // タイトル
        sheet
          .getRange(lastRow + 1, 4)
          .clearContent()
          .setValue(date.getFullYear()); // 年
        sheet
          .getRange(lastRow + 1, 5)
          .clearContent()
          .setValue(sheet.getName()); // カテゴリ
        sheet
          .getRange(lastRow + 1, 7)
          .clearContent()
          .setValue(formatDate(date)); // コメント

        Logger.log(
          `  追加 [${idx + 1}/${itemsToAdd.length}] "${title}" (${formatDate(
            date
          )})`
        );

        lastRow++;
      });

      sendNotificationEmail(
        setting.sheetName,
        itemsToAdd.map(({ title, date }) => ({ title, date: formatDate(date) }))
      );
      Logger.log(`--- シート「${setting.sheetName}」の処理完了 ---`);
    } catch (e) {
      Logger.log(`エラー発生: ${e}`);
    }
  });
  Logger.log("========== RSSチェック処理 終了 ==========");
}

// 以下、extractDateFromTitle, parseDateConsideringYearCross, formatDate, sendNotificationEmailは
// 先ほどのコードと同じです（省略してもよいですが必要なら全文提示します）

function extractDateFromTitle(fullTitle, sheetName) {
  if (sheetName === "FMシアター") {
    const m = fullTitle.match(/[（\(](\d{1,2})月(\d{1,2})日[）\)]/);
    if (m) return `${m[1]}月${m[2]}日`;
  } else if (sheetName === "青春アドベンチャー") {
    const m = fullTitle.match(/[\(（](\d{1,2})月(\d{1,2})日(?:～)?[\)）]/);
    if (m) return `${m[1]}月${m[2]}日`;
  }
  return null;
}

function parseDateConsideringYearCross(monthDayStr) {
  if (!monthDayStr) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const m = monthDayStr.match(/(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);

  let year = currentYear;
  if (currentMonth === 12 && month === 1) {
    year = currentYear + 1;
  }

  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = ("0" + (date.getMonth() + 1)).slice(-2);
  const d = ("0" + date.getDate()).slice(-2);
  return `${y}-${m}-${d}`;
}

function sendNotificationEmail(sheetName, entries) {
  const subject = `${sheetName} の新規RSSエントリー`;
  const body = entries.map((e) => `${e.date} : ${e.title}`).join("\n");
  MailApp.sendEmail(EMAIL_TO, subject, body);
}

// トリガー作成用関数
function createTimeTrigger() {
  // 既存の同じトリガーがあれば削除してから作り直す
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === "checkRSSAndUpdateSheet") {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // 毎日午前9時に実行する時間主導トリガーを作成
  ScriptApp.newTrigger("checkRSSAndUpdateSheet")
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();

  Logger.log("トリガーを作成しました。");
}
