# МесМес — Приватный мессенджер

PWA-мессенджер с авторизацией, поиском по кастомному ID и real-time чатом.

## Быстрый старт (локально)

Дважды кликните по `start-dev.bat` или вручную:

```bash
# Терминал 1 — сервер
cd server
npm install
node --no-warnings index.js

# Терминал 2 — клиент
cd client
npm install
npm run dev
```

Откройте http://localhost:5173

### Тест с мобильного телефона (в одной Wi-Fi сети):

```bash
cd client
npm run dev -- --host
```

Откройте IP-адрес компьютера на порту 5173, например: `http://192.168.1.10:5173`

---

## Деплой на VPS (Ubuntu/Debian)

### 1. Установите Node.js 22+

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Скопируйте проект

```bash
git clone <ваш-репозиторий> /var/www/mes
cd /var/www/mes
```

### 3. Установите зависимости и соберите клиент

```bash
cd server && npm install
cd ../client && npm install && npm run build
```

### 4. Настройте переменные окружения

```bash
cd /var/www/mes/server
cp .env .env.production
nano .env.production
```

Измените:

```
PORT=3001
JWT_SECRET=ваш_длинный_случайный_секрет_минимум_32_символа
CLIENT_ORIGIN=https://ваш-домен.ru
NODE_ENV=production

# YooMoney (mes-premium)
YOOMONEY_RECEIVER=41001XXXXXXXXXXX
YOOMONEY_TOKEN=your_yoomoney_oauth_token
YOOMONEY_NOTIFICATION_SECRET=your_notification_secret
PREMIUM_PRICE_RUB=50
```

### 4.1 Настройка оплаты mes-premium через ЮMoney (50 ₽/месяц)

1. Войдите в кошелёк ЮMoney и включите HTTP-уведомления.
2. Укажите URL уведомлений: `https://ваш-домен.ru/api/payments/yoomoney/webhook`
3. Укажите секрет уведомлений и сохраните его в `YOOMONEY_NOTIFICATION_SECRET`.
4. Получите OAuth-токен YooMoney API (нужен для проверки `operation-history`) и сохраните в `YOOMONEY_TOKEN`.
5. В `YOOMONEY_RECEIVER` укажите номер кошелька получателя.

После этого в приложении на странице `/premium` появится кнопка оплаты:
- `Оплатить 50 ₽ / месяц через ЮMoney`
- после возврата из ЮMoney подписка активируется автоматически;
- если webhook задержался, можно нажать `Проверить оплату`.

> Важно: текущая интеграция продлевает подписку на 1 месяц за каждый успешный платёж. Это помесячная оплата (не автосписание). Для автосписаний обычно используют ЮKassa с рекуррентными платежами.

### 5. Запустите с PM2

```bash
npm install -g pm2
cd /var/www/mes/server
NODE_ENV=production pm2 start index.js --name "mes-server" --node-args="--no-warnings"
pm2 save
pm2 startup
```

### 6. Nginx конфиг

```nginx
server {
    listen 80;
    server_name ваш-домен.ru;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 7. SSL (HTTPS — обязательно для PWA!)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.ru
```

---

## Установка на телефон как приложение

1. Откройте сайт в **Chrome** (Android) или **Safari** (iOS)
2. Android: кнопка "Добавить на главный экран" в меню браузера
3. iOS: кнопка "Поделиться" → "На экран «Домой»"

После этого приложение запускается как нативное — без адресной строки!

---

## Генерация иконок PWA

```bash
cd client
npm install -g sharp-cli
# или
cd client/public/icons
npm install sharp
node generate-icons.js
```

---

## Структура проекта

```
mes/
├── server/           # Node.js + Express + Socket.io
│   ├── index.js      # Главный файл, Socket.io логика
│   ├── database.js   # SQLite (node:sqlite встроенный)
│   ├── routes/
│   │   ├── auth.js   # Регистрация и вход
│   │   └── users.js  # Друзья, поиск, сообщения
│   └── messenger.db  # База данных (создаётся автоматически)
├── client/           # React + Vite + PWA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Register.jsx
│   │   │   ├── Home.jsx    # Список чатов + поиск
│   │   │   └── Chat.jsx    # Чат с другом
│   │   ├── api.js          # Axios с JWT
│   │   └── socket.js       # Socket.io клиент
│   └── public/icons/       # PWA иконки
└── start-dev.bat     # Быстрый запуск на Windows
```
