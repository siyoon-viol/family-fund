/**
 * 우리집 공금통장 — 구글 시트 백엔드
 *
 * 1. 새 구글 시트를 만들고 [확장 프로그램] > [Apps Script]를 엽니다.
 * 2. 이 파일 내용을 Code.gs에 통째로 붙여 넣습니다.
 * 3. 아래 PASSCODE를 가족끼리 쓸 비밀번호로 바꿉니다. (이 값은 GitHub에 올리지 마세요)
 * 4. [배포] > [새 배포] > 유형: 웹 앱, 실행: 나, 액세스 권한: 모든 사용자 → 배포
 * 5. 나오는 웹 앱 URL(https://script.google.com/macros/s/.../exec)을 공금통장 페이지에 입력합니다.
 */
const PASSCODE = '여기에-가족-비밀번호';

const SHEET_TX = '거래내역';
const SHEET_MEMBERS = '구성원';
const SHEET_SETTINGS = '설정';
const TX_HEADER = ['id', '날짜', '구분', '분류', '금액', '구성원ID', '구성원', '회비 월', '적요', '기록 시각'];

function doGet(e) {
  return respond(() => handle(JSON.parse((e && e.parameter && e.parameter.q) || '{}')));
}

function doPost(e) {
  return respond(() => handle(JSON.parse(e.postData.contents)));
}

function respond(fn) {
  let body;
  try { body = fn(); } catch (err) { body = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  if (PASSCODE === '여기에-가족-비밀번호') return { ok: false, error: 'passcode_not_set' };
  if (req.passcode !== PASSCODE) return { ok: false, error: 'wrong_passcode' };

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ensureSheets();
    switch (req.action) {
      case 'load': break;
      case 'addTx': addTx(req.tx); break;
      case 'deleteTx': deleteTx(req.id); break;
      case 'saveSettings': saveSettings(req.settings); break;
      default: return { ok: false, error: 'unknown_action' };
    }
    return { ok: true, settings: readSettings(), txs: readTxs() };
  } finally {
    lock.releaseLock();
  }
}

// ---------- sheets ----------
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function ensureSheets() {
  const book = ss();
  let tx = book.getSheetByName(SHEET_TX);
  if (!tx) {
    tx = book.insertSheet(SHEET_TX);
    tx.getRange(1, 1, 1, TX_HEADER.length).setValues([TX_HEADER]).setFontWeight('bold');
    tx.setFrozenRows(1);
    tx.getRange('B:B').setNumberFormat('@');
    tx.getRange('H:H').setNumberFormat('@');
    tx.getRange('E:E').setNumberFormat('#,##0');
    tx.hideColumns(1);
    tx.hideColumns(6);
  }
  if (!book.getSheetByName(SHEET_MEMBERS)) {
    const m = book.insertSheet(SHEET_MEMBERS);
    m.getRange(1, 1, 1, 2).setValues([['id', '이름']]).setFontWeight('bold');
    m.setFrozenRows(1);
  }
  if (!book.getSheetByName(SHEET_SETTINGS)) {
    const s = book.insertSheet(SHEET_SETTINGS);
    s.getRange(1, 1, 2, 2).setValues([['항목', '값'], ['월 회비', 0]]);
    s.getRange('A1:B1').setFontWeight('bold');
  }
  const blank = book.getSheetByName('시트1') || book.getSheetByName('Sheet1');
  if (blank && book.getSheets().length > 1 && blank.getLastRow() === 0) book.deleteSheet(blank);
}

function fmtDate(v, pattern) {
  if (v instanceof Date) return Utilities.formatDate(v, ss().getSpreadsheetTimeZone(), pattern);
  return String(v || '');
}

function readTxs() {
  const sh = ss().getSheetByName(SHEET_TX);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, TX_HEADER.length).getValues()
    .filter((r) => r[0])
    .map((r) => ({
      id: String(r[0]),
      date: fmtDate(r[1], 'yyyy-MM-dd'),
      type: r[2] === '출금' ? 'out' : 'in',
      category: String(r[3]),
      amount: Number(r[4]) || 0,
      memberId: r[5] ? String(r[5]) : null,
      month: r[7] ? fmtDate(r[7], 'yyyy-MM') : null,
      memo: String(r[8] || ''),
      createdAt: r[9] instanceof Date ? r[9].getTime() : Number(r[9]) || 0,
    }));
}

function readSettings() {
  const m = ss().getSheetByName(SHEET_MEMBERS);
  const n = m.getLastRow() - 1;
  const members = n < 1 ? [] : m.getRange(2, 1, n, 2).getValues()
    .filter((r) => r[0] && r[1])
    .map((r) => ({ id: String(r[0]), name: String(r[1]) }));
  const s = ss().getSheetByName(SHEET_SETTINGS);
  return { members, monthlyDue: Number(s.getRange('B2').getValue()) || 0 };
}

// ---------- writes ----------
function addTx(t) {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error('날짜 형식이 올바르지 않습니다.');
  const amount = Math.round(Number(t.amount));
  if (!(amount > 0)) throw new Error('금액이 올바르지 않습니다.');
  const members = readSettings().members;
  const member = members.find((m) => m.id === t.memberId);
  ss().getSheetByName(SHEET_TX).appendRow([
    Utilities.getUuid(),
    t.date,
    t.type === 'out' ? '출금' : '입금',
    String(t.category || '').slice(0, 20),
    amount,
    member ? member.id : '',
    member ? member.name : '',
    t.month && /^\d{4}-\d{2}$/.test(t.month) ? t.month : '',
    String(t.memo || '').slice(0, 80),
    new Date(),
  ]);
}

function deleteTx(id) {
  const sh = ss().getSheetByName(SHEET_TX);
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return; }
  }
}

function saveSettings(s) {
  const members = (s && Array.isArray(s.members) ? s.members : [])
    .filter((m) => m && m.id && String(m.name || '').trim())
    .slice(0, 30)
    .map((m) => [String(m.id).slice(0, 20), String(m.name).trim().slice(0, 20)]);
  const sh = ss().getSheetByName(SHEET_MEMBERS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  if (members.length) sh.getRange(2, 1, members.length, 2).setValues(members);
  ss().getSheetByName(SHEET_SETTINGS).getRange('B2').setValue(Math.max(0, Math.round(Number(s.monthlyDue) || 0)));
}
