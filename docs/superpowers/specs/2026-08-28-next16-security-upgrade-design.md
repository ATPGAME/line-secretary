# อัปเกรดความปลอดภัยเป็น Next.js 16

วันที่: 28 สิงหาคม 2026

## เป้าหมาย

อัปเกรด `line-secretary` จาก Next.js 15.5.22 เป็น Next.js 16.3.3 เพื่อกำจัดช่องโหว่ใน dependency โดยไม่เปลี่ยนพฤติกรรมของ LINE webhook, worker, ฐานข้อมูล, dashboard หรือฟีเจอร์ผู้ใช้

งานเสร็จเมื่อ dependency production ไม่มีช่องโหว่ที่ `npm audit` ตรวจพบ ชุดทดสอบและ production build ผ่าน และ Preview deployment ตอบสนองเหมือน Production ปัจจุบันก่อนเลื่อนขึ้น Production

## เหตุผลและทางเลือก

การจำลองติดตั้งจาก `package.json` และ `package-lock.json` ปัจจุบันให้ผลดังนี้:

- Next.js 15.5.24 ยังเหลือช่องโหว่ 4 รายการจาก `nanoid`, `postcss` และ `sharp`
- Next.js 16.3.3 เหลือ 0 รายการ
- การใช้ `overrides` เพื่อบังคับ transitive dependencies บน Next.js 15 ลดการเปลี่ยนแปลงระยะสั้น แต่เสี่ยงใช้ชุด dependency ที่ framework ไม่ได้ทดสอบร่วมกัน

จึงเลือกอัปเกรดเป็น Next.js 16.3.3 ซึ่งเป็น Active LTS และเข้ากับ Node.js 24.x ที่ Vercel ใช้อยู่

## ขอบเขต

### ทำในรอบนี้

- อัปเดต `next` เป็น 16.3.3
- อัปเดต `react` และ `react-dom` เป็น 19.2.8
- อัปเดตแพตช์ของ `pg` เป็น 8.23.0 และ `@electric-sql/pglite` เป็น 0.5.8
- ปรับโค้ดเฉพาะจุดที่ Next.js 16 ไม่รองรับ เช่น synchronous request APIs หากตรวจพบ
- เพิ่มคำสั่งตรวจ dependency audit ที่รันซ้ำได้จาก `package.json`
- อัปเดตเอกสารที่อ้างอิงเวอร์ชันหรือขั้นตอนตรวจสอบซึ่งเปลี่ยนไป
- ทดสอบในเครื่อง, Preview และ Production ตามลำดับ

### ไม่ทำในรอบนี้

- เพิ่มฟีเจอร์ LINE หรือเปลี่ยน persona
- เปลี่ยน schema หรือย้ายข้อมูล
- เปลี่ยนหน้าตา dashboard
- เปิด Cache Components, React Compiler หรือฟีเจอร์ทดลองของ Next.js 16
- refactor ไฟล์ขนาดใหญ่ที่ไม่จำเป็นต่อการอัปเกรด

## สถาปัตยกรรมและการไหลของข้อมูล

สถาปัตยกรรมไม่เปลี่ยน:

1. LINE ส่ง event เข้า `app/api/line/route.js`
2. route ตรวจ signature แล้วบันทึกหรือส่งต่อให้สมองตามชนิด event
3. `lib/jobs.js` และ `worker/index.js` ทำงานตามรอบโดยใช้ฐานข้อมูลเดิม
4. dashboard อ่านข้อมูลจากฐานข้อมูลเดิม

การอัปเกรดเปลี่ยนเฉพาะ runtime framework และ dependency lockfile ไม่มี migration และไม่มีการเขียนข้อมูลรูปแบบใหม่

## การรองรับ Next.js 16

- ตรวจทุก page, layout และ route handler ว่าไม่มี synchronous access ต่อ `params`, `searchParams`, `cookies()`, `headers()` หรือ `draftMode()`
- ใช้ Turbopack ซึ่งเป็นค่าเริ่มต้นของ Next.js 16 หาก production build ผ่าน โดยไม่เพิ่ม configuration ที่ไม่จำเป็น
- คง `export const dynamic = 'force-dynamic'` ใน endpoint ที่ต้องอ่านสถานะสด
- คง Node.js engine ขั้นต่ำ `>=22` เพราะเข้มกว่าข้อกำหนดขั้นต่ำของ Next.js 16 และตรงกับการพัฒนาในเครื่อง

## การจัดการข้อผิดพลาดและการย้อนกลับ

- เก็บการอัปเกรด dependency และ compatibility fixes ไว้ใน commit ที่ตรวจสอบได้
- ไม่ deploy Production หาก unit tests, SQL tests, build, audit หรือ Preview smoke tests ไม่ผ่าน
- หาก Preview มี regression ให้แก้บน branch/working tree เดิมโดย Production ยังใช้ deployment ก่อนหน้า
- บันทึก URL ของ Production deployment ที่ผ่าน `/api/health` ก่อนเริ่ม deploy เพื่อใช้เป็น rollback target
- หากปัญหาพบหลัง Production deploy ให้ rollback ผ่าน Vercel ไปยัง target ที่บันทึกไว้ แล้วแก้ไขใน commit ใหม่
- ห้ามใช้การย้อน lockfile เพียงบางส่วน เพราะอาจทำให้ dependency tree ไม่สอดคล้องกัน

## การตรวจสอบ

### ในเครื่อง

1. `npm test`
2. `npm run build`
3. `npm audit --omit=dev --audit-level=moderate` ต้องรายงาน 0 vulnerabilities
4. ตรวจว่า working tree มีเฉพาะไฟล์ในขอบเขต

### Preview deployment

1. หน้า `/` ตอบ 200 และแสดงสถานะตั้งค่าถูกต้อง
2. `/api/health` ตอบ 200 พร้อม `ok: true`
3. `/api/line` ปฏิเสธ request ที่ไม่มี LINE signature
4. dashboard ทำงานตาม access mode ที่ตั้งไว้: เปิดได้โดยไม่ใช้ key เมื่อ `DASHBOARD_PUBLIC=1`; หากปิด public mode ต้องปฏิเสธ key ผิดและเปิดได้ด้วย key ที่ถูกต้อง
5. ตรวจ deployment logs ว่าไม่มี runtime error จาก Next.js 16

### Production

1. Deploy หลัง Preview ผ่านเท่านั้น
2. ตรวจ `/api/health` อีกครั้ง
3. ตรวจ LINE OA ด้วยข้อความที่ไม่สร้างข้อมูลสำคัญ และยืนยันว่าได้รับคำตอบ
4. ตรวจว่า cron/worker health ไม่ stale หลัง deployment

## เกณฑ์ยอมรับ

- `next` เป็น 16.3.3, `react`/`react-dom` เป็น 19.2.8, `pg` เป็น 8.23.0 และ `@electric-sql/pglite` เป็น 0.5.8
- `npm audit` สำหรับ production dependencies เป็นศูนย์
- tests และ build ผ่านทั้งหมด
- ไม่มี schema migration และไม่มีการเปลี่ยนพฤติกรรมฟีเจอร์
- Preview และ Production `/api/health` ตอบ `ok: true`
- มี URL ของ Production deployment ก่อนอัปเกรดเป็น rollback target ที่ระบุได้
