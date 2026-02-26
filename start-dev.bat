@echo off
echo Запуск МесМес...
echo.
echo [1/2] Запускаю backend сервер (порт 3001)...
start "МесМес Backend" cmd /k "cd /d d:\mes\server && node.exe --no-warnings index.js"
timeout /t 2 >nul
echo [2/2] Запускаю frontend Vite (порт 5173)...
start "МесМес Frontend" cmd /k "cd /d d:\mes\client && npm.cmd run dev"
timeout /t 3 >nul
echo.
echo ✅ Готово! Открой http://localhost:5173 в браузере.
echo    Для теста с телефона запусти: npm run dev -- --host
pause
