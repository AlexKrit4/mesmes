import React, { useState } from 'react';
import api from '../../api';
import '../CasinoModals.css';

const BANKS = ['сбер', 'тинькофф', 'яндекс', 'альфа', 'втб'];
const BANK_NAMES = {
  'сбер': '🏦 Сбербанк',
  'тинькофф': '🏪 Тинькофф',
  'яндекс': '💛 Яндекс.Банк',
  'альфа': '🔴 Альфа-Банк',
  'втб': '💙 ВТБ',
};

export default function WithdrawalModal({ onClose, balance, onSuccess }) {
  const [amount, setAmount] = useState('100');
  const [bank, setBank] = useState('сбер');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleWithdraw = async () => {
    if (!amount || parseFloat(amount) < 10) {
      setError('Минимальная сумма вывода: 10 ₽');
      return;
    }

    if (parseFloat(amount) > balance) {
      setError('Недостаточно средств');
      return;
    }

    if (!phone || !/^\d{10,11}$/.test(phone.replace(/\D/g, ''))) {
      setError('Укажите корректный номер телефона');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/casino/withdrawal', {
        amount: parseFloat(amount),
        bank,
        phone,
      });

      setSuccess(true);

      setTimeout(() => {
        onClose();
        onSuccess();
      }, 2000);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.response?.data?.error || 'Ошибка при создании заявки';
      const isPlaythroughError = err.response?.data?.error === 'Playthrough requirement not met';
      
      setError(errorMsg);
      
      // If playthrough error, show error state instead of success
      if (isPlaythroughError) {
        setSuccess(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatPhoneDisplay = (value) => {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length <= 1) return cleaned;
    if (cleaned.length <= 3) return `+7 (${cleaned.slice(1)}`;
    if (cleaned.length <= 6) return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4)}`;
    return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  };

  return (
    <div className="casino-modal-overlay" onClick={onClose}>
      <div className="casino-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <h2>💸 Вывести средства</h2>

        {!success ? (
          <div className="modal-content">
            <div className="form-group">
              <label>Сумма (₽):</label>
              <input
                type="number"
                min="10"
                max={balance}
                step="10"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="available">Доступно: {balance.toFixed(2)} ₽</span>
            </div>

            <div className="form-group">
              <label>Банк:</label>
              <select value={bank} onChange={(e) => setBank(e.target.value)}>
                {BANKS.map((b) => (
                  <option key={b} value={b}>
                    {BANK_NAMES[b]}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Номер телефона:</label>
              <input
                type="tel"
                placeholder="+7 (999) 999-9999"
                value={phone}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  setPhone(value);
                }}
                maxLength="11"
              />
              {phone && <span className="formatted">{formatPhoneDisplay(phone)}</span>}
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="info-message">
              ⏱️ Заявка будет рассмотрена администратором в течение 24 часов
            </div>

            <div className="modal-buttons">
              <button className="btn-primary" onClick={handleWithdraw} disabled={loading}>
                {loading ? 'Обработка...' : 'Вывести средства'}
              </button>
              <button className="btn-secondary" onClick={onClose} disabled={loading}>
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="success-message">
            <div className="success-icon">✅</div>
            <p>Заявка отправлена</p>
            <p className="small">Администратор рассмотрит вашу заявку</p>
          </div>
        )}
      </div>
    </div>
  );
}
