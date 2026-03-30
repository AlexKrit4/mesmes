import React, { useState } from 'react';
import api from '../../api';
import '../CasinoModals.css';

export default function DepositModal({ onClose, onSuccess }) {
  const [amount, setAmount] = useState('50');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState('');

  const commission = parseFloat(amount) * 0.03;
  const total = parseFloat(amount) + commission;

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) < 50) {
      setError('Минимальная сумма пополнения: 50 ₽');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.post('/casino/deposit-yoomoney', {
        amount: parseFloat(amount),
      });

      setPaymentUrl(response.data.paymentUrl);
      setSuccess(true);

      // Open payment URL in new window
      window.open(response.data.paymentUrl, '_blank');

      // Close modal after 2 seconds since user is redirected to payment
      setTimeout(() => {
        onClose();
        onSuccess();
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при создании платежа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="casino-modal-overlay" onClick={onClose}>
      <div className="casino-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        
        <h2>💰 Пополнить баланс</h2>

        {!success ? (
          <div className="modal-content">
            <div className="form-group">
              <label>Сумма (₽):</label>
              <input
                type="number"
                min="50"
                max="10000"
                step="10"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Минимум 50 ₽"
              />
            </div>

            <div className="deposit-summary">
              <div className="summary-row">
                <span>Сумма:</span>
                <span>{parseFloat(amount).toFixed(2)} ₽</span>
              </div>
              <div className="summary-row">
                <span>Комиссия (3%):</span>
                <span>{commission.toFixed(2)} ₽</span>
              </div>
              <div className="summary-row total">
                <span>К оплате:</span>
                <span>{total.toFixed(2)} ₽</span>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="modal-buttons">
              <button className="btn-primary" onClick={handleDeposit} disabled={loading}>
                {loading ? 'Обработка...' : 'Перейти к оплате'}
              </button>
              <button className="btn-secondary" onClick={onClose} disabled={loading}>
                Отмена
              </button>
            </div>

            <p className="info-text">
              💳 Платежи обрабатываются через Яндекс.Касса (Яндекс.Карты, Сбербанк Online, "Мобильный платеж")
            </p>
          </div>
        ) : (
          <div className="success-message">
            <div className="success-icon">✅</div>
            <p>Платеж обработан</p>
            <p className="small">Баланс обновится автоматически</p>
          </div>
        )}
      </div>
    </div>
  );
}
