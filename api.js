/** เรียก Apps Script API (ใช้ text/plain เพื่อหลีกเลี่ยง CORS preflight) */
window.callApi = async function (action, payload, token) {
  const url = String((window.APP_CONFIG || {}).API_URL || '').trim();
  if (!url.startsWith('https://script.google.com/') || !url.endsWith('/exec')) {
    throw new Error('ยังไม่ได้ตั้งค่า API_URL ในไฟล์ config.js (ต้องเป็น URL ของ Apps Script ที่ลงท้ายด้วย /exec)');
  }
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: token || '', payload: payload || {} }),
      redirect: 'follow'
    });
  } catch (e) {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต และการ Deploy Apps Script (ผู้มีสิทธิ์เข้าถึง: ทุกคน)');
  }
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ตรวจสอบว่า Deploy Apps Script เวอร์ชันล่าสุดแล้ว'); }
};
