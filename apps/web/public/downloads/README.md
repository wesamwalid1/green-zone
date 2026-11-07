# مثبّت سطح المكتب

ضع هنا ملف التثبيت بعد بنائه:

```text
GreenZone-Setup.exe
```

أو اضبط المتغير `DESKTOP_DOWNLOAD_URL` ليشير إلى GitHub Release / CDN.

البناء:

```bash
npm run prepare:desktop
npm run dist -w @m5azen/desktop
```

الملف الناتج عادة في `apps/desktop/release/GreenZone-Setup-*.exe`.
