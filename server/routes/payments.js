const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { auth } = require('./users');

const router = express.Router();

const PREMIUM_PRICE_RUB = Number(process.env.PREMIUM_PRICE_RUB || 50);
const PREMIUM_MONTHS = 1;
const MIN_ACCEPTABLE_PAYMENT_RUB = Number(process.env.PREMIUM_MIN_ACCEPTED_RUB || PREMIUM_PRICE_RUB);

const YOOMONEY_RECEIVER = process.env.YOOMONEY_RECEIVER || '';
const YOOMONEY_TOKEN = process.env.YOOMONEY_TOKEN || '';
const YOOMONEY_NOTIFICATION_SECRET = process.env.YOOMONEY_NOTIFICATION_SECRET || '';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

function generateLabel(userId) {
  return `mes-premium-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function toNumberSafe(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'object') {
    if ('amount' in value) return toNumberSafe(value.amount);
    if ('value' in value) return toNumberSafe(value.value);
    if ('sum' in value) return toNumberSafe(value.sum);
    return 0;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function isPaymentAmountEnough(rawPaidAmount, requiredAmount) {
  const paid = toNumberSafe(rawPaidAmount);
  const required = toNumberSafe(requiredAmount);
  const epsilon = 0.01;
  return paid + epsilon >= required;
}

function getOperationAmount(operation) {
  if (!operation || typeof operation !== 'object') return 0;

  const candidates = [
    operation.amount,
    operation.amount_due,
    operation.deposit,
    operation.deposition,
    operation.incoming,
    operation.sum,
    operation.value,
  ];

  for (const candidate of candidates) {
    const parsed = toNumberSafe(candidate);
    if (parsed > 0) return parsed;
  }

  return 0;
}

function addMonthsIso(baseDate, months) {
  const date = new Date(baseDate);
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}

function buildQuickPayUrl({ label, amountRub, successUrl }) {
  const params = new URLSearchParams({
    receiver: YOOMONEY_RECEIVER,
    'quickpay-form': 'shop',
    targets: 'mes-premium',
    paymentType: 'SB',
    sum: String(amountRub),
    label,
    successURL: successUrl,
  });
  return `https://yoomoney.ru/quickpay/confirm.xml?${params.toString()}`;
}

async function fetchSuccessfulOperationByLabel(label) {
  if (!YOOMONEY_TOKEN) {
    return { error: 'YOOMONEY_TOKEN не настроен на сервере' };
  }

  const body = new URLSearchParams({
    label,
    records: '30',
    details: 'true',
    type: 'deposition',
  });

  const response = await fetch('https://yoomoney.ru/api/operation-history', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${YOOMONEY_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    return { error: data.error || `Ошибка YooMoney API: ${response.status}` };
  }

  const operations = Array.isArray(data.operations) ? data.operations : [];
  const successOp = operations.find((op) => op?.status === 'success');
  if (!successOp) return { operation: null };

  return { operation: successOp };
}

function applyPremiumByPayment(payment, operationInfo = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT * FROM premium_payments WHERE id = ?').get(payment.id);
    if (!current) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'Платёж не найден' };
    }

    if (current.status === 'paid') {
      const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(current.user_id);
      db.exec('COMMIT');
      return { ok: true, alreadyPaid: true, premiumUntil: user?.premium_until || null };
    }

    const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(current.user_id);
    const baseDate = user?.premium_until && new Date(user.premium_until) > new Date()
      ? new Date(user.premium_until)
      : new Date();
    const newPremiumUntil = addMonthsIso(baseDate, current.months || PREMIUM_MONTHS);

    db.prepare('UPDATE users SET premium_until = ? WHERE id = ?').run(newPremiumUntil, current.user_id);
    db.prepare(`
      UPDATE premium_payments
      SET status = 'paid',
          provider_operation_id = ?,
          paid_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      operationInfo.operationId || null,
      operationInfo.paidAt || new Date().toISOString(),
      current.id
    );

    db.exec('COMMIT');
    return { ok: true, alreadyPaid: false, premiumUntil: newPremiumUntil };
  } catch (e) {
    db.exec('ROLLBACK');
    return { ok: false, error: e.message || 'Не удалось активировать premium' };
  }
}

// POST /api/payments/premium/create
router.post('/premium/create', auth, (req, res) => {
  if (!YOOMONEY_RECEIVER) {
    return res.status(500).json({ error: 'YOOMONEY_RECEIVER не настроен на сервере' });
  }

  const label = generateLabel(req.userId);
  const amountRub = PREMIUM_PRICE_RUB;
  const successUrl = `${CLIENT_ORIGIN}/premium?payment=return&label=${encodeURIComponent(label)}`;
  const paymentUrl = buildQuickPayUrl({ label, amountRub, successUrl });

  db.prepare(`
    INSERT INTO premium_payments (user_id, label, amount_rub, months, status, provider)
    VALUES (?, ?, ?, ?, 'pending', 'yoomoney')
  `).run(req.userId, label, amountRub, PREMIUM_MONTHS);

  return res.json({
    label,
    amount_rub: amountRub,
    months: PREMIUM_MONTHS,
    payment_url: paymentUrl,
  });
});

// POST /api/payments/premium/confirm
router.post('/premium/confirm', auth, async (req, res) => {
  const { label } = req.body || {};
  if (!label) return res.status(400).json({ error: 'label обязателен' });

  const payment = db.prepare('SELECT * FROM premium_payments WHERE label = ? AND user_id = ?').get(label, req.userId);
  if (!payment) {
    return res.status(202).json({
      success: false,
      paid: false,
      message: 'Платёж ещё не найден. Подождите немного и повторите проверку.',
    });
  }

  if (payment.status === 'paid') {
    const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
    return res.json({ success: true, paid: true, already_paid: true, premium_until: user?.premium_until || null });
  }

  try {
    const check = await fetchSuccessfulOperationByLabel(label);
    if (check.error) {
      console.warn('[payments] confirm check error:', check.error, 'label=', label);
      const refreshed = db.prepare('SELECT status, paid_at FROM premium_payments WHERE id = ?').get(payment.id);
      if (refreshed?.status === 'paid') {
        const user = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(req.userId);
        return res.json({ success: true, paid: true, already_paid: true, premium_until: user?.premium_until || null });
      }
      return res.status(202).json({
        success: false,
        paid: false,
        message: 'Платёж ещё не подтверждён. Ожидаем webhook от YooMoney.',
        check_error: check.error,
      });
    }
    if (!check.operation) {
      return res.status(202).json({ success: false, paid: false, message: 'Платёж ещё не подтверждён YooMoney' });
    }

    const opAmount = getOperationAmount(check.operation);
    if (!isPaymentAmountEnough(opAmount, MIN_ACCEPTABLE_PAYMENT_RUB)) {
      console.warn('[payments] operation amount too small', {
        label,
        opAmount,
        minRequired: MIN_ACCEPTABLE_PAYMENT_RUB,
        price: payment.amount_rub,
      });
      return res.status(400).json({ error: `Оплаченная сумма меньше требуемой (${payment.amount_rub} ₽)` });
    }

    const result = applyPremiumByPayment(payment, {
      operationId: check.operation.operation_id || null,
      paidAt: check.operation.datetime || new Date().toISOString(),
    });
    if (!result.ok) return res.status(500).json({ error: result.error || 'Ошибка активации premium' });

    return res.json({
      success: true,
      paid: true,
      already_paid: !!result.alreadyPaid,
      premium_until: result.premiumUntil,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Ошибка подтверждения платежа' });
  }
});

// GET /api/payments/premium/status
router.get('/premium/status', auth, (req, res) => {
  const payments = db.prepare(`
    SELECT id, label, amount_rub, months, status, provider_operation_id, paid_at, created_at
    FROM premium_payments
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 20
  `).all(req.userId);
  res.json(payments);
});

// POST /api/payments/yoomoney/webhook
router.post('/yoomoney/webhook', (req, res) => {
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
      console.warn('[payments] webhook missing fields', {
        hasLabel: !!label,
        hasSha1: !!sha1_hash,
        notification_type,
      });
      return res.status(400).send('missing');
    }
    if (!YOOMONEY_NOTIFICATION_SECRET) return res.status(500).send('secret-not-configured');

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
      console.warn('[payments] webhook bad signature', { label, operation_id });
      return res.status(403).send('bad-sign');
    }

    const payment = db.prepare('SELECT * FROM premium_payments WHERE label = ?').get(label);
    if (!payment) {
      console.warn('[payments] webhook payment not found by label', { label, operation_id, amount });
      return res.status(200).send('ok');
    }
    if (payment.status === 'paid') return res.status(200).send('ok');

    const amountRub = toNumberSafe(amount);
    if (!isPaymentAmountEnough(amountRub, MIN_ACCEPTABLE_PAYMENT_RUB)) {
      console.warn('[payments] webhook amount too small', {
        label,
        amountRub,
        minRequired: MIN_ACCEPTABLE_PAYMENT_RUB,
        price: payment.amount_rub,
      });
      return res.status(400).send('small-amount');
    }

    const result = applyPremiumByPayment(payment, {
      operationId: operation_id || null,
      paidAt: datetime || new Date().toISOString(),
    });
    if (!result.ok) {
      console.error('[payments] webhook apply premium failed', { label, operation_id, error: result.error });
      return res.status(500).send('error');
    }

    console.log('[payments] premium activated via webhook', { label, operation_id, user_id: payment.user_id });

    return res.status(200).send('ok');
  } catch {
    return res.status(500).send('error');
  }
});

module.exports = router;
