# ติดตั้งด้วย Claude Code

> ไฟล์นี้เขียนถึง **Claude** ที่กำลังช่วยผู้ใช้ติดตั้ง — ผู้ใช้เป็นมือใหม่ ไม่เคยเขียนโค้ด เป้าหมายคือใช้งานได้จริงภายใน 2 ชั่วโมง

## กติกา

- **ถามทีละอย่าง** อย่ายิงคำถาม 5 ข้อพร้อมกัน ผู้ใช้จะงง
- ทุกครั้งที่ให้ผู้ใช้ไปกดอะไรในเว็บ **บอกชื่อปุ่มตรง ๆ** และบอกว่าจะเห็นอะไรหลังกด
- **อย่าให้ผู้ใช้เห็น error ดิบ** — แปลเป็นภาษาคนแล้วบอกว่าต้องทำอะไรต่อ
- ค่าที่เป็นความลับ (token/key) เขียนลง `.env.local` เท่านั้น **ห้าม commit ห้าม echo ออกหน้าจอ**
- ถ้าผู้ใช้ติดขั้นไหนเกิน 2 รอบ ให้ข้ามไปทำขั้นที่ทำได้ก่อน แล้ววนกลับมา

## ลำดับการติดตั้ง

### 0. เตรียม
```bash
npm install
cp .env.example .env.local
```

### 1. เก็บค่าจาก LINE (ผู้ใช้ต้องกดเอง)
บอกผู้ใช้ทีละข้อ แล้วรับค่ามาเขียนลง `.env.local`:
1. [developers.line.biz](https://developers.line.biz) → Log in ด้วย LINE → Create provider (ตั้งชื่ออะไรก็ได้) → Create channel → **Messaging API**
2. แท็บ **Basic settings** → **Channel secret** → ขอค่านี้ (`LINE_CHANNEL_SECRET`)
3. แท็บ **Messaging API** → **Channel access token** → กด **Issue** → ขอค่านี้ (`LINE_CHANNEL_ACCESS_TOKEN`)
4. แท็บ **Messaging API** → **Allow bot to join group chats** → Edit → เปิด
5. ⚠️ คนละเว็บ: [manager.line.biz](https://manager.line.biz) → OA ตัวเอง → **การตั้งค่า → การตอบกลับ** → **ปิด** "ข้อความตอบกลับอัตโนมัติ" และ "ข้อความต้อนรับ"
   (ข้อนี้คนพลาดเยอะที่สุด ถ้าไม่ปิด ข้อความสำเร็จรูปจะแย่งตอบจนบอทเงียบ)

### 2. OpenRouter
[openrouter.ai](https://openrouter.ai) → Sign in with Google → **Credits** เติม $5 → **Keys** → Create key
→ `OPENROUTER_API_KEY` (ขึ้นให้ดูครั้งเดียว ให้ผู้ใช้ก๊อปทันที)

### 3. ฐานข้อมูล Neon
[neon.tech](https://neon.tech) → Sign up with GitHub → Create project (ชื่ออะไรก็ได้ · region Singapore)
→ **Connection string** เลือกอันที่มีคำว่า **Pooled connection** → `DATABASE_URL`

### 4. ตั้ง DASHBOARD_KEY
สุ่มให้เลย ไม่ต้องถามผู้ใช้:
```bash
node -e "console.log(require('crypto').randomBytes(12).toString('hex'))"
```

### 5. สร้างตาราง + เช็คว่าค่าครบ
```bash
node scripts/setup.mjs
```
ถ้าฟ้องว่าขาดค่าอะไร ให้กลับไปเก็บค่านั้นก่อน

### 6. Deploy ขึ้น Vercel
ให้ผู้ใช้สมัคร [vercel.com](https://vercel.com) ด้วย GitHub ก่อน แล้ว:
```bash
npx vercel@latest login
npx vercel@latest --prod --yes
```
จากนั้นใส่ env ทุกตัวใน `.env.local` ขึ้น Vercel (ทำให้ผู้ใช้ อย่าให้เขาพิมพ์เอง):
```bash
npx vercel@latest env add LINE_CHANNEL_ACCESS_TOKEN production
# ทำแบบเดียวกันกับ LINE_CHANNEL_SECRET, OPENROUTER_API_KEY, DATABASE_URL, DASHBOARD_KEY
npx vercel@latest --prod --yes   # deploy ซ้ำให้ค่ามีผล
```

### 7. ต่อ LINE เข้ากับเว็บ (อัตโนมัติ ไม่ต้องกดในเว็บ LINE)
```bash
node scripts/setup.mjs https://<โดเมนที่ vercel ให้มา>
```
ต้องขึ้น `✅ LINE ยิงทดสอบผ่าน` ถ้าไม่ผ่าน สคริปต์จะบอกเองว่าเช็คอะไร

### 8. เอา userId ของผู้ใช้
บอกผู้ใช้: แท็บ Messaging API → สแกน **QR code** → แอดเพื่อน → ทักบอทว่า **ไอดี**
บอทจะตอบ userId กลับมา → ใส่เป็น `OWNER_USER_ID` ทั้งใน `.env.local` และ Vercel → deploy ซ้ำ

### 9. Railway (ตัวรายงานอัตโนมัติ — ข้ามได้ถ้ายังไม่อยากจ่าย $5)
ให้ผู้ใช้สมัคร [railway.app](https://railway.app) ด้วย GitHub + ผูกบัตร แล้ว:
```bash
npx @railway/cli login
npx @railway/cli init
npx @railway/cli up
```
ตั้ง Start Command เป็น `node worker/index.js` และใส่ variables ชุดเดียวกับ Vercel
เช็คว่า log ขึ้น `worker started`

## เช็คก่อนบอกว่าเสร็จ

1. ทักบอทว่า `จดไว้ รหัส wifi 12345678` → ต้องตอบว่าบันทึกแล้ว
2. ถามต่อว่า `รหัส wifi อะไรนะ` → ต้องตอบได้ (แปลว่าความจำทำงาน)
3. ส่งรูปสลิปโอนเงิน → ต้องบอกยอดกลับมา
4. เปิด `https://โดเมน/` → ต้องขึ้น ✅ ทุกข้อ
5. เชิญบอทเข้ากลุ่มทดสอบ → บอทแนะนำตัว → พิมพ์ในกลุ่มว่า `เลขา สรุปให้หน่อย` → ต้องสรุปได้

ถ้าครบ 5 ข้อ บอกผู้ใช้ว่าเสร็จแล้ว และบอกสิ่งที่ปรับแต่งต่อได้: เวลารายงาน · คำที่ให้เตือน · เวลารอตอบ (อยู่ในตาราง `watched` — ดู README)
