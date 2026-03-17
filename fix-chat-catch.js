const fs = require('fs');
let code = fs.readFileSync('client/src/pages/Chat.jsx', 'utf8');

code = code.replace("console.error('File upload error', err);", `console.error('File upload error', err);
          if (err.response?.status === 413) {
             alert(err.response?.data?.error || 'Размер файла превышает допустимый лимит.');
          } else {
             alert(err.response?.data?.error || 'Ошибка загрузки файла');
          }`);

fs.writeFileSync('client/src/pages/Chat.jsx', code);
console.log('done catch');
