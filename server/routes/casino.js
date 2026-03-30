const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { auth } = require('./users');
const slot = require('../slotMath');

const router = express.Router();

// Middleware
function isAdmin(req, res, next) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function hasSlotAccess(req, res, next) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = db.prepare('SELECT can_play_slots FROM users WHERE id = ?').get(req.userId);
  if (!user || !user.can_play_slots) {
    return res.status(403).json({ error: 'No slot access' });
  }
  next();
}

// GET /casino/check-access - Check if user has casino access
router.get('/check-access', auth, (req, res) => {
  try {
    const user = db.prepare('SELECT can_play_slots FROM users WHERE id = ?').get(req.userId);
    res.json({ hasAccess: user?.can_play_slots === 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /casino/balance - Get current balance
router.get('/balance', auth, hasSlotAccess, (req, res) => {
  try {
    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(req.userId);
    res.json({ balance: user?.casino_balance || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /casino/spin - Execute a spin
router.post('/spin', auth, hasSlotAccess, (req, res) => {
  try {
    const { betAmount } = req.body;
    
    if (!betAmount || betAmount < 0.20 || betAmount > 100) {
      return res.status(400).json({ error: 'Invalid bet amount (0.20 - 100)' });
    }

    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(req.userId);
    if ((user?.casino_balance || 0) < betAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Spin the reels
    const grid = slot.spinReels();
    const { totalWinnings, winningLines } = slot.calculateWinnings(grid, betAmount);

    // Update balance
    const newBalance = (user?.casino_balance || 0) - betAmount + totalWinnings;
    db.prepare('UPDATE users SET casino_balance = ? WHERE id = ?').run(newBalance, req.userId);

    res.json({
      grid,
      betAmount,
      winnings: totalWinnings,
      balance: newBalance,
      winningLines: winningLines.map(wl => ({
        line: wl.line,
        symbol: wl.symbol,
        matchLength: wl.matchLength,
        winnings: wl.winnings,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /casino/fund - Fund the casino balance directly (admin/testing)
router.post('/fund', auth, hasSlotAccess, (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // For now, allow users to fund themselves (testing)
    // In production, this would be restricted or require admin approval
    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(req.userId);
    const newBalance = (user?.casino_balance || 0) + amount;
    db.prepare('UPDATE users SET casino_balance = ? WHERE id = ?').run(newBalance, req.userId);

    res.json({ balance: newBalance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /casino/deposit-yoomoney - Initiate Yoomoney deposit
router.post('/deposit-yoomoney', auth, hasSlotAccess, (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount < 50) {
      return res.status(400).json({ error: 'Minimum deposit: 50 RUB' });
    }

    const commission = amount * 0.03;
    const total = amount + commission;

    // Generate unique label
    const label = `casino-deposit-${req.userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Create deposit record
    db.prepare(`
      INSERT INTO casino_deposits (user_id, amount, commission, total_charged, yoomoney_label)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.userId, amount, commission, total, label);

    const deposit = db.prepare(`
      SELECT id FROM casino_deposits WHERE yoomoney_label = ?
    `).get(label);

    res.json({
      depositId: deposit.id,
      amount,
      commission,
      total,
      label,
      // In production, return Yoomoney payment URL
      // For now, return payment URL format
      paymentUrl: `https://yoomoney.ru/quickpay/confirm?receiver=${process.env.YOOMONEY_RECEIVER || 'test'}&quickpay-form=shop&targets=Casino%20deposit&sum=${total}&label=${label}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /casino/deposit-history - Get deposit history
router.get('/deposit-history', auth, hasSlotAccess, (req, res) => {
  try {
    const deposits = db.prepare(`
      SELECT id, amount, commission, total_charged, status, created_at, paid_at
      FROM casino_deposits
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.userId);

    res.json({ deposits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /casino/withdrawal - Request withdrawal
router.post('/withdrawal', auth, hasSlotAccess, (req, res) => {
  try {
    const { amount, bank, phone } = req.body;

    const validBanks = ['сбер', 'тинькофф', 'яндекс', 'альфа', 'втб'];
    if (!amount || amount < 50 || !bank || !validBanks.includes(bank.toLowerCase()) || !phone) {
      return res.status(400).json({ error: 'Invalid withdrawal data' });
    }

    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(req.userId);
    if ((user?.casino_balance || 0) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Create withdrawal request
    const result = db.prepare(`
      INSERT INTO casino_withdrawals (user_id, amount, bank, phone)
      VALUES (?, ?, ?, ?)
    `).run(req.userId, amount, bank.toLowerCase(), phone);

    // Deduct from balance immediately
    const newBalance = (user?.casino_balance || 0) - amount;
    db.prepare('UPDATE users SET casino_balance = ? WHERE id = ?').run(newBalance, req.userId);

    res.json({
      withdrawalId: result.lastInsertRowid,
      amount,
      bank,
      phone,
      status: 'pending',
      balance: newBalance,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /casino/withdrawal-history - Get withdrawal history
router.get('/withdrawal-history', auth, hasSlotAccess, (req, res) => {
  try {
    const withdrawals = db.prepare(`
      SELECT id, amount, bank, phone, status, admin_comment, created_at, reviewed_at, canceled_at
      FROM casino_withdrawals
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.userId);

    res.json({ withdrawals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /casino/withdrawal/:id/cancel - Cancel withdrawal (within 1 minute)
router.patch('/withdrawal/:id/cancel', auth, hasSlotAccess, (req, res) => {
  try {
    const withdrawal = db.prepare(`
      SELECT * FROM casino_withdrawals WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    if (!withdrawal) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'Can only cancel pending withdrawals' });
    }

    // Check if created within last minute
    const createdAt = new Date(withdrawal.created_at);
    const now = new Date();
    const minutesPassed = (now - createdAt) / (1000 * 60);

    if (minutesPassed > 1) {
      return res.status(400).json({ error: 'Can only cancel within 1 minute' });
    }

    // Mark as canceled
    db.prepare(`
      UPDATE casino_withdrawals SET canceled_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.params.id);

    // Refund balance
    const refundAmount = withdrawal.amount;
    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(req.userId);
    const newBalance = (user?.casino_balance || 0) + refundAmount;
    db.prepare('UPDATE users SET casino_balance = ? WHERE id = ?').run(newBalance, req.userId);

    res.json({ status: 'canceled', balance: newBalance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN ENDPOINTS ====================

// GET /casino/admin/access-list - Get users with casino access
router.get('/admin/access-list', auth, isAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, public_id, casino_balance, can_play_slots, created_at
      FROM users
      WHERE can_play_slots = 1
      ORDER BY created_at DESC
    `).all();

    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /casino/admin/grant-access - Grant slot access to user
router.post('/admin/grant-access', auth, isAdmin, (req, res) => {
  try {
    const { userId, initialBalance = 100 } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    db.prepare('UPDATE users SET can_play_slots = 1, casino_balance = ? WHERE id = ?').run(initialBalance, userId);

    res.json({ success: true, message: 'Slot access granted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /casino/admin/revoke-access - Revoke slot access from user
router.post('/admin/revoke-access', auth, isAdmin, (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    db.prepare('UPDATE users SET can_play_slots = 0 WHERE id = ?').run(userId);

    res.json({ success: true, message: 'Slot access revoked' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /casino/admin/withdrawals - Get all pending withdrawals
router.get('/admin/withdrawals', auth, isAdmin, (req, res) => {
  try {
    const { status = 'pending' } = req.query;

    const withdrawals = db.prepare(`
      SELECT w.*, u.username, u.public_id
      FROM casino_withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = ? OR w.canceled_at IS NULL
      ORDER BY w.created_at DESC
    `).all(status);

    res.json({ withdrawals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /casino/admin/withdrawal/:id - Get withdrawal details
router.get('/admin/withdrawal/:id', auth, isAdmin, (req, res) => {
  try {
    const withdrawal = db.prepare(`
      SELECT w.*, u.username, u.public_id
      FROM casino_withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.id = ?
    `).get(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ withdrawal });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /casino/admin/withdrawal/:id/approve - Approve withdrawal
router.patch('/admin/withdrawal/:id/approve', auth, isAdmin, (req, res) => {
  try {
    const { adminComment = '' } = req.body;

    db.prepare(`
      UPDATE casino_withdrawals 
      SET status = 'approved', admin_comment = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(adminComment, req.params.id);

    res.json({ status: 'approved' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /casino/admin/withdrawal/:id/reject - Reject withdrawal
router.patch('/admin/withdrawal/:id/reject', auth, isAdmin, (req, res) => {
  try {
    const { adminComment = '' } = req.body;

    const withdrawal = db.prepare(`
      SELECT * FROM casino_withdrawals WHERE id = ?
    `).get(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Refund balance
    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(withdrawal.user_id);
    const newBalance = (user?.casino_balance || 0) + withdrawal.amount;
    db.prepare('UPDATE users SET casino_balance = ? WHERE id = ?').run(newBalance, withdrawal.user_id);

    // Mark as rejected
    db.prepare(`
      UPDATE casino_withdrawals 
      SET status = 'rejected', admin_comment = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(adminComment, req.params.id);

    res.json({ status: 'rejected' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== WEBHOOK ====================

// POST /casino/yoomoney-webhook - Yoomoney webhook for casino deposits
router.post('/yoomoney-webhook', (req, res) => {
  try {
    const {
      notification_type,
      operation_id,
      amount,
      currency,
      datetime,
      sender,
      codepro,
      label,
      sha1_hash,
    } = req.body || {};

    if (!label || !sha1_hash) {
      console.warn('[casino] webhook missing fields', { hasLabel: !!label, hasSha1: !!sha1_hash });
      return res.status(400).send('missing');
    }

    const YOOMONEY_NOTIFICATION_SECRET = process.env.YOOMONEY_NOTIFICATION_SECRET || '';
    if (!YOOMONEY_NOTIFICATION_SECRET) {
      console.error('[casino] webhook secret not configured');
      return res.status(500).send('secret-not-configured');
    }

    // Verify SHA1 signature
    const base = [
      notification_type,
      operation_id,
      amount,
      currency,
      datetime,
      sender,
      codepro,
      YOOMONEY_NOTIFICATION_SECRET,
      label,
    ].join('&');

    const localHash = crypto.createHash('sha1').update(base).digest('hex');
    if (String(localHash).toLowerCase() !== String(sha1_hash).toLowerCase()) {
      console.warn('[casino] webhook bad signature', { label, operation_id });
      return res.status(403).send('bad-sign');
    }

    // Find deposit record
    const deposit = db.prepare('SELECT * FROM casino_deposits WHERE yoomoney_label = ?').get(label);
    if (!deposit) {
      console.warn('[casino] webhook deposit not found by label', { label, operation_id, amount });
      return res.status(200).send('ok');
    }

    // Already processed
    if (deposit.status === 'paid') {
      return res.status(200).send('ok');
    }

    const amountRub = parseFloat(amount);
    if (amountRub < deposit.total_charged - 0.01) {
      console.warn('[casino] webhook amount too small', {
        label,
        amountRub,
        required: deposit.total_charged,
      });
      return res.status(400).send('small-amount');
    }

    // Update deposit status
    db.prepare(`
      UPDATE casino_deposits 
      SET status = 'paid', yoomoney_operation_id = ?, paid_at = ?
      WHERE id = ?
    `).run(operation_id || null, datetime || new Date().toISOString(), deposit.id);

    // Credit balance
    const user = db.prepare('SELECT casino_balance FROM users WHERE id = ?').get(deposit.user_id);
    const newBalance = (user?.casino_balance || 0) + deposit.amount;
    db.prepare('UPDATE users SET casino_balance = ? WHERE id = ?').run(newBalance, deposit.user_id);

    console.log('[casino] deposit credited via webhook', {
      deposit_id: deposit.id,
      user_id: deposit.user_id,
      amount: deposit.amount,
      operation_id,
    });

    return res.status(200).send('ok');
  } catch (error) {
    console.error('[casino] webhook error:', error.message);
    return res.status(500).send('error');
  }
});

module.exports = router;
