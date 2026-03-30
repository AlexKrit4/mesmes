const express = require('express');
const db = require('../database');
const { auth } = require('./users');

const router = express.Router();

// GET /block-blast/check-access - Check if user has block blast access
router.get('/check-access', auth, (req, res) => {
  try {
    const user = db.prepare('SELECT can_play_block_blast, is_admin FROM users WHERE id = ?').get(req.userId);
    const hasAccess = user?.is_admin === 1 || user?.can_play_block_blast === 1;
    res.json({ hasAccess });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
