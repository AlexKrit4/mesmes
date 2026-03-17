const fs = require('fs');
let code = fs.readFileSync('server/routes/channels.js', 'utf8');

// Update msgStorage and msgUpload (channels.js)
const oldStorage = `const msgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, \`ch_\${req.userId}_\${Date.now()}\${ext}\`);
  },
});
const msgUpload = multer({
  storage: msgStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    if (/^(image\\/(jpeg|png|webp|gif|heic|heif)|video\\/(mp4|webm|mov|quicktime|x-msvideo|x-matroska|3gpp))$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения и видео'));
  },
});`;

const newStorage = `const msgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, \`ch_\${req.userId}_\${Date.now()}_\${Math.random().toString(36).slice(2,8)}\${ext}\`);
  },
});
const msgUpload = multer({
  storage: msgStorage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB max
});`;

code = code.replace(oldStorage, newStorage);

const oldRoute = `  msgUpload.array('files', 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите изображение' });
    const urls = req.files.map(f => \`/uploads/\${f.filename}\`);
    res.json({ file_urls: urls });
  });`;

const newRoute = `  msgUpload.array('files', 5)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Файл слишком велик (макс. 30 МБ для Premium)' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите файл' });

    const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
    const isPremium = user && user.premium_until && new Date(user.premium_until) > new Date();
    const maxSize = isPremium ? 30 * 1024 * 1024 : 5 * 1024 * 1024;

    for (const f of req.files) {
      if (f.size > maxSize) {
        for (const cf of req.files) fs.unlink(cf.path, () => {});
        return res.status(413).json({ 
          error: isPremium ? 'Максимальный размер файла для Premium 30 МБ' : 'Максимальный размер файла 5 МБ. Приобретите Premium для отправки до 30 МБ.'
        });
      }
    }

    const filesData = req.files.map(f => ({
      url: \`/uploads/\${f.filename}\`,
      name: f.originalname,
      type: f.mimetype,
      size: f.size
    }));
    res.json({ file_url: JSON.stringify(filesData), file_urls: filesData });
  });`;

code = code.replace(oldRoute, newRoute);
fs.writeFileSync('server/routes/channels.js', code);
console.log('done channels');
