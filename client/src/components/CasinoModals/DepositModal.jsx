import React, { useEffect, useState } from 'react';
import api from '../../api';
import '../CasinoModals.css';

export default function DepositModal({ onClose, onSuccess }) {
  const [amount, setAmount] = useState('50');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState('');
  const [depositId, setDepositId] = useState(null);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const commission = parseFloat(amount) * 0.03;
  const total = parseFloat(amount) + commission;

  useEffect(() => {
    let timer = null;

    async function autoCheck() {
      if (!success || !depositId || reconcileLoading) return;
      try {
        setReconcileLoading(true);
        const response = await api.post('/casino/deposit-yoomoney/reconcile', { depositId });
        if (response.data?.credited) {
          setStatusMessage('Платеж подтвержден. Баланс обновлен.');
          onSuccess();
        }
      } catch {
        // Ignore background check errors to avoid noisy UI.
      } finally {
        setReconcileLoading(false);
      }
    }

    if (success && depositId) {
      timer = setInterval(autoCheck, 7000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [success, depositId, reconcileLoading, onSuccess]);

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
      setDepositId(response.data.depositId);
      setSuccess(true);
      setStatusMessage('Ожидаем оплату. После оплаты нажми "Проверить оплату".');

      // Open payment URL in new window
      window.open(response.data.paymentUrl, '_blank');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при создании платежа');
    } finally {
      setLoading(false);
    }
  };

  const handleReconcile = async () => {
    if (!depositId) return;

    setReconcileLoading(true);
    setError('');
    try {
      const response = await api.post('/casino/deposit-yoomoney/reconcile', { depositId });
      if (response.data?.credited) {
        setStatusMessage('Платеж подтвержден. Баланс обновлен.');
        onSuccess();
      } else {
        setStatusMessage('Оплата пока не подтверждена. Подожди 10-20 секунд и нажми еще раз.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось проверить оплату');
    } finally {
      setReconcileLoading(false);
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
            <p>Ссылка на оплату открыта</p>
            <p className="small">{statusMessage || 'После оплаты вернись и проверь платеж'}</p>
            <div className="modal-buttons" style={{ marginTop: 16 }}>
              <button className="btn-primary" onClick={handleReconcile} disabled={reconcileLoading}>
                {reconcileLoading ? 'Проверяем...' : 'Проверить оплату'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => window.open(paymentUrl, '_blank')}
                disabled={!paymentUrl}
              >
                Открыть оплату снова
              </button>
            </div>
            {error && <div className="error-message" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
