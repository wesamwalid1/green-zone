@echo off
echo === M5azen Setup ===
call npm install
cd apps\api
call npx prisma generate
call npx prisma db push
call npx tsx prisma\seed.ts
cd ..\..
echo.
echo Setup done. Login: admin / admin123
echo Run: npm run dev:api   and   npm run dev:web
pause
