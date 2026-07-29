# เลขา LINE OA — ออกแบบตัวจริง (v2: เฝ้ากลุ่ม + ประวัติ + สุขภาพ + สลิป)

v1 (แชท 1:1 + โน้ต + to-do) โค้ดเสร็จแล้วในโฟลเดอร์นี้ · เอกสารนี้คือส่วนที่ต้องต่อเติมเมื่องานคือ "เฝ้ากลุ่ม รายงานเรื่อย ๆ เก็บประวัติ สุขภาพ สลิป"

---

## กฎข้อเดียวที่ตัดสินทั้งระบบ: **หู ≠ สมอง**

กลุ่ม LINE ที่ active จริงมี 300–1,000 ข้อความ/วัน/กลุ่ม ถ้ายิงเข้า LLM ทุกข้อความ = จ่ายค่า token ให้ข้อความ "555" กับ "โอเคครับ" และช้าจน LINE timeout

```
คนพิมพ์ในกลุ่ม
  → [หู] Vercel /api/line — verify + เขียนลง Postgres แล้วตอบ 200 ทันที (ไม่เรียก LLM เลย)

ทุก 10 นาที
  → [สมอง] Railway worker — ดึงข้อความที่ยังไม่ประมวลผล → LLM สรุป/สกัด → เก็บผล
  → ถึงรอบรายงาน (เช้า/เย็น) → push สรุปเข้าแชท 1:1 ของเจ้าของ

ยกเว้น 2 กรณีที่ตอบทันทีในหู:
  - แชท 1:1 (เลขาส่วนตัว เหมือน v1)
  - ในกลุ่มแล้วถูก @mention ตรง ๆ
```

**ผลพลอยได้:** ข้อความในกลุ่มถูกเก็บครบ 100% แม้ LLM ล่ม/เครดิตหมด — ค่อยประมวลผลย้อนหลังได้

---

## ของที่ใช้ และเหตุผลที่ต้องมี

| ตัว | ทำอะไร | ราคา | ตัดออกได้ไหม |
|---|---|---|---|
| **Vercel** | webhook (หู) + dashboard | ฟรี | ไม่ — ต้องมี endpoint ที่ตอบเร็วและไม่ล่ม |
| **Railway** | worker + cron ทุก 10 นาที + งานยาว (อ่านสลิป/สรุป) | $5/เดือน | ได้ ถ้าใช้ cron-job.org ฟรียิงเข้า Vercel แทน แต่ติด timeout ของ serverless |
| **Neon Postgres** | ประวัติทั้งหมด — ต้อง query ย้อนหลังได้ | ฟรี → $19 | ไม่ — Redis JSON ก้อนเดียวของ v1 ทำ "สรุปสุขภาพ 3 เดือน" ไม่ได้ |
| **OpenRouter** | สรุป + อ่านสลิป (vision) | ~$2–15/เดือน | ไม่ |
| **Vercel Blob / R2** | เก็บไฟล์รูปสลิป | ฟรี–$1 | ได้ ถ้าเก็บแค่ตัวเลขที่อ่านได้ ไม่เก็บรูป |

**รวมประมาณ $10–25/เดือน** (ยังไม่รวมแพ็ก LINE ถ้า push เกินโควตา)

**Railway คุ้มตรงไหน:** Vercel Hobby รัน cron ได้วันละครั้งและคลาดเวลา ±1 ชม. — งานที่ต้อง "คอยรายงานเรื่อย ๆ" ทำไม่ได้เลย ส่วน Railway รันทุกกี่นาทีก็ได้ ไม่มี timeout กดดัน นี่คือเหตุผลเดียวแต่เพียงพอที่จะจ่าย $5

---

## ตาราง (Postgres)

```sql
-- หู: raw ingest ห้ามมี logic
create table messages (
  id bigserial primary key,
  line_message_id text unique,        -- กัน LINE ส่งซ้ำ (retry ได้เสมอ)
  source_type text not null,          -- user | group | room
  source_id text not null,
  user_id text,
  kind text not null,                 -- text | image
  text text,
  blob_key text,                      -- ไฟล์รูป ถ้ามี
  ts timestamptz not null,
  processed_at timestamptz            -- null = worker ยังไม่แตะ
);
create index on messages (processed_at, ts);

-- สมอง: ผลที่สกัดได้
create table reports (
  id bigserial primary key,
  source_id text not null,
  period_start timestamptz, period_end timestamptz,
  summary text, action_items jsonb,
  created_at timestamptz default now()
);

create table health (
  id bigserial primary key,
  user_id text not null,
  kind text not null,                 -- weight | bp | sugar | med | symptom
  value numeric, unit text, note text,
  recorded_at timestamptz not null,
  source_message_id bigint references messages(id)
);

create table slips (
  id bigserial primary key,
  user_id text not null,
  amount numeric, bank text, ref text,
  paid_at timestamptz,
  confidence numeric,                 -- ต่ำ = ให้คนยืนยันก่อน
  raw jsonb, blob_key text,
  source_message_id bigint references messages(id),
  unique (ref, amount)                -- กันสลิปเดิมส่งซ้ำ
);
```

---

## 6 จุดที่พังจริงถ้าไม่ทำตั้งแต่แรก

1. **รูปสลิปโหลดได้ครั้งเดียว** — LINE เก็บไฟล์ไว้ชั่วคราว ต้องดึงจาก `api-data.line.me/v2/bot/message/{id}/content` **ตอน ingest ทันที** ไม่ใช่รอ worker มาดึงทีหลัง (สายแล้วไฟล์หาย)
2. **LINE ส่ง webhook ซ้ำได้** เมื่อ timeout/retry → ต้องมี `line_message_id unique` ไม่งั้นสลิปใบเดียวถูกบันทึกสองรอบ
3. **สลิปซ้ำ / สลิปปลอม** — vision อ่านผิดได้และคนส่งสลิปเดิมซ้ำได้ ต้อง unique (ref, amount) + เก็บ confidence + ยอดเกินเกณฑ์ให้คนยืนยันก่อน **ห้ามตัดสินใจเงินอัตโนมัติ**
4. **push เข้ากลุ่มกินโควตาตามจำนวนคนในกลุ่ม** — รายงานเข้าแชท 1:1 ของเจ้าของแทน ปลอดภัยกว่ามาก (ฟรี 300 push/เดือน = รายงานวันละ 3 ครั้งยังอยู่ในโควตา)
5. **ข้อมูลสุขภาพ = ข้อมูลอ่อนไหวตาม PDPA** ต้องขอความยินยอมชัดแจ้ง, ห้าม `console.log` ข้อความดิบ (ขึ้น log ของ Vercel/Railway), dashboard ต้อง login จริง — `?key=` ของ v1 ไม่พอสำหรับข้อมูลสุขภาพ
6. **บอทอยู่ในกลุ่มคนอื่น** — ให้บอทแนะนำตัวตอนถูกเชิญเข้ากลุ่ม ว่าอ่านข้อความเพื่อสรุป และตั้ง retention ลบ raw messages หลัง 30–90 วัน เหลือแต่สรุป

---

## ลำดับที่ควรทำ

1. v1 ที่มีอยู่ (แชท 1:1 + โน้ต + to-do) → deploy ให้ใช้ได้จริงก่อน
2. เปลี่ยน store จาก Redis เป็น Neon + ตาราง `messages` + รับ event จากกลุ่ม (ยังไม่เรียก LLM)
3. Railway worker: สรุปกลุ่ม + รายงานเช้า/เย็น
4. สลิป (vision + กันซ้ำ)
5. สุขภาพ (+ consent flow + login dashboard)
