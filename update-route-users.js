const fs = require('fs');
let code = fs.readFileSync('server/routes/users.js', 'utf8');

const oldRoute = `// POST /api/users/messages/file — upload images for message (up to 5)
router.post('/messages/file', auth, (req, res) => {
  msgUpload.array('files', 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите изображение' });
    const urls = req.files.map(f => \`/uploads/\${f.filename}\`);
    // Return single URL for backward compat, plus array
    res.json({ file_url: JSON.stringify(urls), file_urls: urls });
  });
});`;

const newRoute = `// POST /api/users/messages/file — upload files for message
router.post('/messages/file', auth, (req, res) => {
  msgUpload.array('files', 5)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Файл слишком велик (макс. 30 МБ для Premium)' });
      }
      return res.status(400).json({ error: err.message || 'Ошибка загрузки' });
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Выберите файл' });

    const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
    const isPremium = user && user.premium_until && new Date(user.premium_until) > new Date();
    const maxSize = isPremium ? 30 * 1024 * 1024 : 5 * 1024 * 1024;

    for (const f of req.files) {
      if (f.size > maxSize) {
        // delete all just uploaded
        for (const cf of req.files) fs.unlink(cf.path, () => {});
        return res.status(413).json({ 
          error: isPremium ? 'Максимальный размер файла для Premium 30 МБ' : 'Максимальный размер файла 5 МБ. Приобретите Premium для отправки до 30 МБ.',
          limitExceeded: true,
          maxAllowed: maxSize
        });
      }
    }

    const filesData = req.files.map(f => ({
      url: \`/uploads/\${f.filename}\`,
      name: f.originalname,
      type: f.mimetype,
      size: f.size
    }));
    
    // Fallback to array of URLs for backward compat on clients if any, 
    // but store raw JSON object array string in file_url
    res.json({ file_url: JSON.stringify(filesData), filesData });
  });
});`;

fs.writeFileSync('server/routes/users.js', code.replace(oldRoute, newRoute));
console.log('done users Route');
