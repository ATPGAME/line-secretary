// อ่านปฏิทิน Google โดยไม่ต้องทำ OAuth — ใช้ "ที่อยู่ลับในรูปแบบ iCal" ของปฏิทินตัวเอง
// Google Calendar > ตั้งค่าปฏิทิน > รวมปฏิทิน > ที่อยู่ลับในรูปแบบ iCal → ใส่เป็น env CALENDAR_ICS_URL
// ใส่หลายปฏิทินได้ คั่นด้วยจุลภาค · อ่านอย่างเดียว (สร้าง/แก้นัดไม่ได้ ต้องใช้ OAuth ถึงจะทำได้)
//
// ⚠️ ที่อยู่ลับ = ใครมีลิงก์ก็อ่านปฏิทินได้ทั้งใบ เก็บใน env เท่านั้น ห้าม commit

const TZ = 'Asia/Bangkok';
const ONE_DAY = 86400000;

export const hasCalendar = () => !!process.env.CALENDAR_ICS_URL;

// ── แปลงวันเวลาแบบ iCal เป็น Date
// ponytail: ถือว่าเวลาที่ไม่มี Z คือเวลาไทย — ปฏิทินของคนไทยตั้งโซนไทยอยู่แล้ว
// ถ้าวันหนึ่งต้องรองรับปฏิทินต่างประเทศ ค่อยแปลงตาม TZID จริง
function parseDate(value, params = '') {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', utc] = m;
  const allDay = /VALUE=DATE/.test(params) || !value.includes('T');
  const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${utc ? 'Z' : '+07:00'}`;
  const at = new Date(iso);
  return isNaN(at) ? null : { at, allDay };
}

const unescape_ = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// ── แตกไฟล์ .ics เป็นรายการนัด (คลี่นัดที่เกิดซ้ำให้ด้วย)
export function parseIcs(text, from, to) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events = [];

  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const field = (name) => {
      const m = body.match(new RegExp(`^${name}([^:\\r\\n]*):(.*)$`, 'm'));
      return m ? { params: m[1], value: m[2].trim() } : null;
    };

    const start = field('DTSTART');
    if (!start) continue;
    const s = parseDate(start.value, start.params);
    if (!s) continue;

    const end = field('DTEND');
    const e = end && parseDate(end.value, end.params);
    const title = unescape_(field('SUMMARY')?.value || '(ไม่มีชื่อ)');
    const where = unescape_(field('LOCATION')?.value || '');
    const length = e ? e.at - s.at : (s.allDay ? ONE_DAY : 3600000);

    for (const at of occurrences(s.at, field('RRULE')?.value, from, to)) {
      events.push({ at, end: new Date(+at + length), allDay: s.allDay, title, where });
    }
  }
  return events.filter((v) => v.end > from && v.at < to).sort((a, b) => a.at - b.at);
}

// วันในสัปดาห์ตามเวลาไทย (ไม่ใช่ UTC — ตี 1 บ้านเราคือเมื่อวานของ UTC)
const weekdayBangkok = (d) => new Date(d.toLocaleString('en-US', { timeZone: TZ })).getDay();

// นัดที่เกิดซ้ำ — รองรับ FREQ/INTERVAL/BYDAY/UNTIL/COUNT
// ponytail: ไม่รองรับ EXDATE (นัดที่ถูกยกเลิกเป็นครั้ง ๆ จะยังโผล่) — เจอปัญหาเมื่อไหร่ค่อยเติม
function occurrences(first, rrule, from, to) {
  if (!rrule) return [first];
  const rule = Object.fromEntries(rrule.split(';').map((p) => p.split('=')));
  const step = { DAILY: 1, WEEKLY: 7 }[rule.FREQ];
  const interval = Number(rule.INTERVAL) || 1;
  const until = rule.UNTIL ? parseDate(rule.UNTIL)?.at : null;
  const count = Number(rule.COUNT) || Infinity;
  const days = rule.BYDAY?.split(',').map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d.slice(-2)));

  const out = [];
  const cursor = new Date(first);
  const limit = new Date(Math.min(+to, until ? +until : +to));

  // เดินทีละวันจนถึงปลายช่วงที่ถาม — ถามทีละไม่กี่วัน วนแค่หลักสิบรอบ
  for (let i = 0; cursor <= limit && out.length < count && i < 800; i++) {
    const okDay = !days?.length || days.includes(weekdayBangkok(cursor));
    if (cursor >= from && okDay) out.push(new Date(cursor));
    if (rule.FREQ === 'MONTHLY') cursor.setUTCMonth(cursor.getUTCMonth() + interval);
    else if (rule.FREQ === 'YEARLY') cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
    else cursor.setUTCDate(cursor.getUTCDate() + (days?.length ? 1 : (step || 1) * interval));
  }
  return out;
}

// ── ดึงนัดจากทุกปฏิทินที่ตั้งไว้
export async function agenda({ days = 1, skip = 0 } = {}) {
  const urls = (process.env.CALENDAR_ICS_URL || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return null;

  const midnight = new Date(new Date().toLocaleDateString('en-CA', { timeZone: TZ }) + 'T00:00:00+07:00');
  const from = new Date(+midnight + skip * ONE_DAY);
  const to = new Date(+from + days * ONE_DAY);

  const all = [];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ics ${res.status}`);
      all.push(...parseIcs(await res.text(), from, to));
    } catch (err) {
      console.error('calendar failed:', err.message);
    }
  }
  return all.sort((a, b) => a.at - b.at);
}

// ── ข้อความสั้น ๆ ไว้ตอบในแชทและแปะหัวรายงาน
export function agendaText(events, label = 'วันนี้') {
  if (events === null) return 'ยังไม่ได้ต่อปฏิทิน — ใส่ CALENDAR_ICS_URL ก่อน';
  if (!events.length) return `${label}ไม่มีนัดในปฏิทิน`;
  const line = (v) => {
    const t = v.allDay
      ? 'ทั้งวัน'
      : new Date(v.at).toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    const day = new Date(v.at).toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short' });
    return `• ${day} ${t} ${v.title}${v.where ? ` @ ${v.where}` : ''}`;
  };
  return `📅 ${label} ${events.length} นัด\n${events.map(line).join('\n')}`;
}
