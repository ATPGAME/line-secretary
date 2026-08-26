export const metadata = { title: 'เลขาส่วนตัวใน LINE' };

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700;800&display=swap"
        />
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
