/**
 * ระบบแบบสอบถามความพึงพอใจในการให้บริการ ศาลจังหวัดอุดรธานี
 * Google Apps Script Web App + Google Sheets
 *
 * Google Apps Script = JSON API อ่าน/เขียน Google Sheet
 * หน้าเว็บ (index.html / admin.html) โฮสต์บน Vercel และเรียก API นี้ผ่าน config.js
 * ลิงก์เฉพาะส่วนงาน : https://<โดเมน vercel>/?unit=r05
 */

const CONFIG = {
  SPREADSHEET_ID: '1eR-fAiuNPTAq0veV6aWB9yBQyYnXAGYXsWYzq33YvJs',
  ORG_NAME: 'ศาลจังหวัดอุดรธานี',
  SYSTEM_NAME: 'ระบบแบบสอบถามความพึงพอใจในการให้บริการ',
  TZ: 'Asia/Bangkok',
  SHEET_RESPONSES: 'Responses',
  SHEET_USERS: 'Users',
  SHEET_LOGS: 'Logs',
  SESSION_SECONDS: 21600,          // อายุการล็อกอิน 6 ชั่วโมง (ต่ออายุอัตโนมัติเมื่อใช้งาน)
  COMMENT_MAX: 500,
  DEFAULT_ADMIN: { username: 'admin', password: 'Admin@1234', name: 'ผู้ดูแลระบบ' }
};

const AGE_RANGES = ['ต่ำกว่า 20 ปี', '20 – 39 ปี', '40 – 59 ปี', '60 ปีขึ้นไป'];
const GENDERS = ['ชาย', 'หญิง', 'ไม่ระบุเพศ'];
const RATING_LABELS = ['ปรับปรุง', 'พอใช้', 'ปานกลาง', 'ดี', 'ดีเยี่ยม']; // คะแนน 1–5
const ROLES = {
  admin: 'แอดมิน',
  executive: 'หัวหน้าศาลฯ/ผู้อำนวยการฯ',
  staff: 'เจ้าหน้าที่'
};

/** ส่วนงานที่ให้บริการ (แก้ไขชื่อ/เพิ่มงานย่อยได้ที่นี่) */
const SERVICES = [
  { id: 's01', group: 'main', name: 'ส่วนบริการประชาชนและประชาสัมพันธ์', subs: ['งานบริการประชาชน', 'งานประกัน', 'งานบังคับคดี'] },
  { id: 's02', group: 'main', name: 'ส่วนบริหารจัดการคดี', subs: ['งานรับฟ้อง', 'งานอุทธรณ์/ฎีกา', 'งานหมาย', 'งานเก็บสำนวน'] },
  { id: 's03', group: 'main', name: 'ส่วนไกล่เกลี่ยและประนอมข้อพิพาท', subs: [] },
  { id: 's04', group: 'main', name: 'ส่วนช่วยพิจารณาคดี', subs: ['ศูนย์นัดความชั้น 1', 'ศูนย์นัดความชั้น 2'] }
].concat(
  Array.from({ length: 12 }, (_, i) => ({
    id: 'r' + String(i + 1).padStart(2, '0'),
    group: 'room',
    name: 'ห้องพิจารณาคดีที่ ' + (i + 1),
    short: String(i + 1),
    subs: []
  })),
  [
    { id: 's05', group: 'support', name: 'ส่วนช่วยอำนวยการ', subs: ['งานสารบรรณหนังสือ'] },
    { id: 's06', group: 'support', name: 'ส่วนคลัง', subs: ['งานบัญชีคดี', 'งานการเงิน'] },
    { id: 's07', group: 'support', name: 'ส่วนเจ้าพนักงานคดี', subs: [] },
    { id: 's08', group: 'support', name: 'ส่วนเจ้าพนักงานตำรวจศาล', subs: [] },
    { id: 's09', group: 'support', name: 'ส่วนเทคโนโลยีสารสนเทศ', subs: [] },
    { id: 's10', group: 'support', name: 'เจ้าหน้าที่รักษาความปลอดภัย (รปภ.)', subs: [] },
    { id: 's11', group: 'support', name: 'แม่บ้าน', subs: [] },
    { id: 's99', group: 'other', name: 'อื่นๆ', subs: [], other: true }
  ]
);

const RESP_HEADERS = ['รหัส', 'วันที่-เวลา', 'ช่วงอายุ', 'เพศ', 'ส่วนงาน', 'งานย่อย', 'ระบุ (อื่นๆ)', 'ความคิดเห็น/ข้อเสนอแนะ', 'คะแนน', 'ระดับความพึงพอใจ', 'ปัญหาที่พบ'];
const USER_HEADERS = ['ชื่อผู้ใช้', 'ชื่อ-สกุล', 'ตำแหน่ง', 'สิทธิ์', 'สถานะ', 'Salt', 'PasswordHash', 'สร้างเมื่อ', 'เข้าระบบล่าสุด'];
const LOG_HEADERS = ['วันที่-เวลา', 'ผู้ใช้', 'การกระทำ', 'รายละเอียด'];

/* =========================================================
 * JSON API (หน้าเว็บอยู่บน Vercel แล้วเรียกมาที่นี่ด้วย fetch)
 *   POST body (text/plain): {"action":"...", "token":"...", "payload":{...}}
 * ======================================================= */
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const p = req.payload || {};
    switch (req.action) {
      case 'config': out = { ok: true, data: configData_() }; break;
      case 'submit': out = submitSurvey(p); break;
      case 'login':  out = login(p.username, p.password); break;
      case 'logout': out = logout(req.token); break;
      default:       out = api(req.token, req.action, p);
    }
  } catch (err) {
    out = { ok: false, error: 'คำขอไม่ถูกต้อง: ' + err.message };
  }
  return json_(out);
}

/** เปิด URL /exec ในเบราว์เซอร์เพื่อตรวจว่า API ทำงานอยู่ */
function doGet() {
  return json_({ ok: true, service: CONFIG.SYSTEM_NAME + ' ' + CONFIG.ORG_NAME, time: fmt_(new Date()) });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function configData_() {
  return {
    org: CONFIG.ORG_NAME,
    system: CONFIG.SYSTEM_NAME,
    services: SERVICES,
    ages: AGE_RANGES,
    genders: GENDERS,
    ratingLabels: RATING_LABELS,
    roles: ROLES,
    commentMax: CONFIG.COMMENT_MAX
  };
}

/* =========================================================
 * ติดตั้งระบบ (รันครั้งแรก 1 ครั้งจากตัวแก้ไข Apps Script)
 * ======================================================= */
function setup() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone(CONFIG.TZ);

  const r = sheet_(CONFIG.SHEET_RESPONSES, RESP_HEADERS);
  r.getRange('A:A').setNumberFormat('@');
  r.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  r.setColumnWidth(2, 150); r.setColumnWidth(5, 260); r.setColumnWidth(8, 360);

  const u = sheet_(CONFIG.SHEET_USERS, USER_HEADERS);
  u.getRange('A:A').setNumberFormat('@');
  if (u.getLastRow() < 2) {
    const salt = Utilities.getUuid();
    u.appendRow([CONFIG.DEFAULT_ADMIN.username, CONFIG.DEFAULT_ADMIN.name, 'ผู้ดูแลระบบ', 'admin', 'active',
      salt, hash_(CONFIG.DEFAULT_ADMIN.password, salt), new Date(), '']);
  }

  sheet_(CONFIG.SHEET_LOGS, LOG_HEADERS);
  PropertiesService.getScriptProperties().setProperty('READY', '1');
  return 'ติดตั้งเรียบร้อย ผู้ใช้เริ่มต้น: ' + CONFIG.DEFAULT_ADMIN.username + ' / ' + CONFIG.DEFAULT_ADMIN.password;
}

function ensureReady_() {
  if (PropertiesService.getScriptProperties().getProperty('READY') !== '1') setup();
}

/* =========================================================
 * รับข้อมูลแบบสอบถาม (สาธารณะ)
 * ======================================================= */
function submitSurvey(f) {
  try {
    f = f || {};
    if (f.website) return { ok: true }; // honeypot กันบอท
    ensureReady_();

    const age = String(f.age || '');
    if (AGE_RANGES.indexOf(age) < 0) throw new Error('กรุณาเลือกช่วงอายุ');
    const gender = String(f.gender || '');
    if (GENDERS.indexOf(gender) < 0) throw new Error('กรุณาเลือกเพศ');

    const unit = SERVICES.filter(s => s.id === f.unitId)[0];
    if (!unit) throw new Error('กรุณาเลือกงานที่รับบริการ');
    let sub = '';
    if (unit.subs.length) {
      sub = String(f.sub || '');
      if (unit.subs.indexOf(sub) < 0) throw new Error('กรุณาเลือกงานย่อยของ ' + unit.name);
    }
    let other = '';
    if (unit.other) {
      other = clean_(f.other, 150);
      if (!other) throw new Error('กรุณาระบุงานที่รับบริการ');
    }
    const comment = clean_(f.comment, CONFIG.COMMENT_MAX);
    const problem = clean_(f.problem, CONFIG.COMMENT_MAX);
    const rating = parseInt(f.rating, 10);
    if (!(rating >= 1 && rating <= 5)) throw new Error('กรุณาให้คะแนนความพึงพอใจ');

    const now = new Date(); // เวลาจากเซิร์ฟเวอร์เท่านั้น
    const id = 'SV' + Utilities.formatDate(now, CONFIG.TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100);

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      sheet_(CONFIG.SHEET_RESPONSES, RESP_HEADERS)
        .appendRow([id, now, age, gender, unit.name, sub, other, comment, rating, RATING_LABELS[rating - 1], problem]);
    } finally {
      lock.releaseLock();
    }
    return { ok: true, id: id, ts: fmt_(now) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* =========================================================
 * เข้าสู่ระบบ / ออกจากระบบ
 * ======================================================= */
function login(username, password) {
  try {
    ensureReady_();
    username = String(username || '').trim().toLowerCase();
    password = String(password || '');
    const cache = CacheService.getScriptCache();
    const failKey = 'fail_' + username;
    const fails = Number(cache.get(failKey) || 0);
    if (fails >= 5) throw new Error('เข้าสู่ระบบผิดพลาดเกิน 5 ครั้ง กรุณารอ 10 นาทีแล้วลองใหม่');

    const u = readUsers_().filter(x => x.username === username)[0];
    if (!u || hash_(password, u.salt) !== u.hash) {
      cache.put(failKey, String(fails + 1), 600);
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    if (u.status !== 'active') throw new Error('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    cache.remove(failKey);

    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    const sess = { username: u.username, name: u.name, position: u.position, role: u.role };
    cache.put('sess_' + token, JSON.stringify(sess), CONFIG.SESSION_SECONDS);
    sheet_(CONFIG.SHEET_USERS, USER_HEADERS).getRange(u.row, 9).setValue(new Date());
    log_(u.username, 'เข้าสู่ระบบ', '');

    const mustChange = u.username === CONFIG.DEFAULT_ADMIN.username && password === CONFIG.DEFAULT_ADMIN.password;
    return { ok: true, token: token, user: sess, mustChange: mustChange };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return { ok: true };
}

/* =========================================================
 * API หลังบ้าน (ต้องมี token)
 * ======================================================= */
const ACTIONS = {
  me:             { run: s => s },
  responses:      { run: (s, p) => readResponses_(validDate_(p.from), validDate_(p.to)) },
  deleteResponse: { admin: true, run: deleteResponse_ },
  users:          { admin: true, run: () => readUsers_().map(publicUser_) },
  saveUser:       { admin: true, run: saveUser_ },
  resetPassword:  { admin: true, run: resetPassword_ },
  deleteUser:     { admin: true, run: deleteUser_ },
  changePassword: { run: changePassword_ }
};

function api(token, action, payload) {
  try {
    const s = session_(token);
    if (!s) return { ok: false, auth: true, error: 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่' };
    const a = ACTIONS[action];
    if (!a) throw new Error('ไม่รู้จักคำสั่ง');
    if (a.admin && s.role !== 'admin') throw new Error('เฉพาะแอดมินเท่านั้นที่ใช้งานส่วนนี้ได้');
    return { ok: true, data: a.run(s, payload || {}) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function session_(token) {
  if (!token || typeof token !== 'string') return null;
  const c = CacheService.getScriptCache();
  const raw = c.get('sess_' + token);
  if (!raw) return null;
  const s = JSON.parse(raw);
  const u = readUsers_().filter(x => x.username === s.username)[0];
  if (!u || u.status !== 'active') { c.remove('sess_' + token); return null; }
  const fresh = { username: u.username, name: u.name, position: u.position, role: u.role };
  c.put('sess_' + token, JSON.stringify(fresh), CONFIG.SESSION_SECONDS); // ต่ออายุ
  return fresh;
}

/* ---------- ข้อมูลแบบสอบถาม ---------- */
function readResponses_(from, to) {
  const sh = sheet_(CONFIG.SHEET_RESPONSES, RESP_HEADERS);
  const n = sh.getLastRow();
  if (n < 2) return [];
  const vals = sh.getRange(2, 1, n - 1, RESP_HEADERS.length).getValues();
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    const r = vals[i];
    if (!r[0] && !r[1]) continue;
    const ts = fmt_(r[1]);
    const d = ts.slice(0, 10);
    if (from && d < from) continue;
    if (to && d > to) continue;
    out.push({
      id: String(r[0]), ts: ts, age: String(r[2]), gender: String(r[3]),
      unit: String(r[4]), sub: String(r[5]), other: String(r[6]), comment: String(r[7]),
      rating: Number(r[8]) || 0, level: String(r[9]), problem: String(r[10] == null ? '' : r[10])
    });
  }
  return out;
}

function deleteResponse_(s, p) {
  const id = String(p.id || '');
  if (!id) throw new Error('ไม่พบรหัสรายการ');
  const sh = sheet_(CONFIG.SHEET_RESPONSES, RESP_HEADERS);
  const cell = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  if (!cell || cell.getRow() < 2) throw new Error('ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)');
  sh.deleteRow(cell.getRow());
  log_(s.username, 'ลบแบบสอบถาม', id);
  return true;
}

/* ---------- ผู้ใช้งาน ---------- */
function readUsers_() {
  const sh = sheet_(CONFIG.SHEET_USERS, USER_HEADERS);
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, USER_HEADERS.length).getValues()
    .map((r, i) => ({
      row: i + 2, username: String(r[0]).trim().toLowerCase(), name: String(r[1]), position: String(r[2]),
      role: String(r[3]), status: String(r[4]), salt: String(r[5]), hash: String(r[6]),
      createdAt: fmt_(r[7]), lastLogin: fmt_(r[8])
    }))
    .filter(u => u.username);
}

function publicUser_(u) {
  return { username: u.username, name: u.name, position: u.position, role: u.role, status: u.status, createdAt: u.createdAt, lastLogin: u.lastLogin };
}

function saveUser_(s, p) {
  const username = String(p.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('ชื่อผู้ใช้ต้องเป็น a-z, 0-9 หรือ . _ - ยาว 3–30 ตัวอักษร');
  const name = clean_(p.name, 100);
  if (!name) throw new Error('กรุณากรอกชื่อ-สกุล');
  const position = clean_(p.position, 100);
  const role = String(p.role || '');
  if (!ROLES[role]) throw new Error('สิทธิ์ไม่ถูกต้อง');
  const status = p.status === 'inactive' ? 'inactive' : 'active';

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const users = readUsers_();
    const ex = users.filter(u => u.username === username)[0];
    const sh = sheet_(CONFIG.SHEET_USERS, USER_HEADERS);
    if (p.mode === 'create') {
      if (ex) throw new Error('มีชื่อผู้ใช้นี้อยู่แล้ว');
      checkPassword_(p.password);
      const salt = Utilities.getUuid();
      sh.appendRow([username, name, position, role, status, salt, hash_(String(p.password), salt), new Date(), '']);
      log_(s.username, 'เพิ่มผู้ใช้', username + ' (' + ROLES[role] + ')');
    } else {
      if (!ex) throw new Error('ไม่พบผู้ใช้');
      const losingAdmin = ex.role === 'admin' && ex.status === 'active' && (role !== 'admin' || status !== 'active');
      if (losingAdmin && ex.username === s.username) throw new Error('ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
      if (losingAdmin && activeAdmins_(users) <= 1) throw new Error('ต้องมีแอดมินที่ใช้งานได้อย่างน้อย 1 บัญชี');
      sh.getRange(ex.row, 2, 1, 4).setValues([[name, position, role, status]]);
      log_(s.username, 'แก้ไขผู้ใช้', username);
    }
  } finally {
    lock.releaseLock();
  }
  return readUsers_().map(publicUser_);
}

function resetPassword_(s, p) {
  const u = readUsers_().filter(x => x.username === String(p.username || '').toLowerCase())[0];
  if (!u) throw new Error('ไม่พบผู้ใช้');
  checkPassword_(p.password);
  setPassword_(u, p.password);
  log_(s.username, 'รีเซ็ตรหัสผ่าน', u.username);
  return true;
}

function deleteUser_(s, p) {
  const users = readUsers_();
  const u = users.filter(x => x.username === String(p.username || '').toLowerCase())[0];
  if (!u) throw new Error('ไม่พบผู้ใช้');
  if (u.username === s.username) throw new Error('ไม่สามารถลบบัญชีของตนเองได้');
  if (u.role === 'admin' && u.status === 'active' && activeAdmins_(users) <= 1) throw new Error('ต้องมีแอดมินที่ใช้งานได้อย่างน้อย 1 บัญชี');
  sheet_(CONFIG.SHEET_USERS, USER_HEADERS).deleteRow(u.row);
  log_(s.username, 'ลบผู้ใช้', u.username);
  return readUsers_().map(publicUser_);
}

function changePassword_(s, p) {
  const u = readUsers_().filter(x => x.username === s.username)[0];
  if (!u) throw new Error('ไม่พบผู้ใช้');
  if (hash_(String(p.oldPassword || ''), u.salt) !== u.hash) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');
  checkPassword_(p.newPassword);
  if (p.newPassword === p.oldPassword) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  setPassword_(u, p.newPassword);
  log_(s.username, 'เปลี่ยนรหัสผ่าน', '');
  return true;
}

function setPassword_(u, pw) {
  const salt = Utilities.getUuid();
  sheet_(CONFIG.SHEET_USERS, USER_HEADERS).getRange(u.row, 6, 1, 2).setValues([[salt, hash_(String(pw), salt)]]);
}

function activeAdmins_(users) {
  return users.filter(u => u.role === 'admin' && u.status === 'active').length;
}

function checkPassword_(pw) {
  if (!pw || String(pw).length < 8) throw new Error('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
}

/* =========================================================
 * Utilities
 * ======================================================= */
function ss_() { return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID); }

function sheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#1b2748').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < headers.length) {
    // เพิ่มหัวคอลัมน์ใหม่ต่อท้ายให้ชีตเดิม (ข้อมูลเก่าไม่เสีย)
    const from = sh.getLastColumn() + 1;
    sh.getRange(1, from, 1, headers.length - from + 1).setValues([headers.slice(from - 1)])
      .setFontWeight('bold').setBackground('#1b2748').setFontColor('#ffffff');
  }
  return sh;
}

function hash_(pw, salt) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 300; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8)
      .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return h;
}

function clean_(s, max) {
  let v = String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim().slice(0, max);
  if (/^[=+\-@]/.test(v)) v = "'" + v; // กันสูตร (formula injection) ใน Sheet
  return v;
}

function fmt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
  return String(v == null ? '' : v);
}

function validDate_(d) {
  d = String(d || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

function log_(user, action, detail) {
  try {
    sheet_(CONFIG.SHEET_LOGS, LOG_HEADERS).appendRow([new Date(), user, action, detail]);
  } catch (e) { /* ไม่ให้ log ทำให้งานหลักล้ม */ }
}
