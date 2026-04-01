import React, { useState, useEffect } from 'react';
import api from '../../api';
import '../CasinoModals.css';

export default function HistoryModal({ onClose, onWithdrawalCanceled }) {
  const [activeTab, setActiveTab] = useState('deposits');
  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelingId, setCancelingId] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    // Refresh timer display every second to update countdown
    const interval = setInterval(() => {
      setRefreshTrigger(t => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');

    try {
      const [depositsRes, withdrawalsRes] = await Promise.all([
        api.get('/casino/deposit-history'),
        api.get('/casino/withdrawal-history'),
      ]);

      setDeposits(depositsRes.data.deposits);
      setWithdrawals(withdrawalsRes.data.withdrawals);
    } catch (err) {
      setError('Ошибка при загрузке истории');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelWithdrawal = async (id) => {
    setCancelingId(id);

    try {
      await api.patch(`/casino/withdrawal/${id}/cancel`);
      fetchHistory();
      onWithdrawalCanceled();
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при отмене');
    } finally {
      setCancelingId(null);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status) => {
    const statuses = {
      pending: { text: 'На рассмотрении', class: 'status-pending' },
      approved: { text: 'Одобрено ✅', class: 'status-approved' },
      rejected: { text: 'Отклонено ❌', class: 'status-rejected' },
    };
    const s = statuses[status] || { text: status, class: 'status-unknown' };
    return <span className={`status-badge ${s.class}`}>{s.text}</span>;
  };

  return (
    <div className="casino-modal-overlay" onClick={onClose}>
      <div className="casino-modal casino-modal-large" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <h2>📋 История операций</h2>

        <div className="history-tabs">
          <button
            className={`tab ${activeTab === 'deposits' ? 'active' : ''}`}
            onClick={() => setActiveTab('deposits')}
          >
            💰 Пополнения
          </button>
          <button
            className={`tab ${activeTab === 'withdrawals' ? 'active' : ''}`}
            onClick={() => setActiveTab('withdrawals')}
          >
            💸 Выводы
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="history-content">
          {loading ? (
            <div className="loading">Загрузка...</div>
          ) : activeTab === 'deposits' ? (
            <div className="deposits-list">
              {deposits.length === 0 ? (
                <p className="empty">Нет пополнений</p>
              ) : (
                deposits.map((deposit) => (
                  <div key={deposit.id} className="history-item deposit-item">
                    <div className="history-item-header">
                      <div className="amount">
                        +{deposit.amount.toFixed(2)} ₽
                        <span className="commission">
                          ({deposit.commission.toFixed(2)} ₽ комиссия)
                        </span>
                      </div>
                      {getStatusBadge(deposit.status)}
                    </div>
                    <div className="history-item-date">
                      {formatDate(deposit.created_at)}
                    </div>
                    {deposit.paid_at && (
                      <div className="history-item-date small">
                        Оплачено: {formatDate(deposit.paid_at)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="withdrawals-list">
              {withdrawals.length === 0 ? (
                <p className="empty">Нет выводов</p>
              ) : (
                withdrawals.map((withdrawal) => {
                  const isActive = withdrawal.status === 'pending' && !withdrawal.canceled_at;
                  const createdAt = new Date(withdrawal.created_at);
                  const now = new Date();
                  const secPassed = (now - createdAt) / 1000;
                  const secondsRemaining = Math.max(0, 60 - secPassed);
                  const canCancel = isActive && secondsRemaining > 0;

                  return (
                    <div key={withdrawal.id} className="history-item withdrawal-item">
                      <div className="history-item-header">
                        <div className="amount">
                          -{withdrawal.amount.toFixed(2)} ₽
                          <span className="bank">на {withdrawal.bank}</span>
                        </div>
                        {getStatusBadge(withdrawal.status)}
                      </div>
                      <div className="history-item-details">
                        <div className="detail">
                          <span className="label">Телефон:</span>
                          <span className="value">
                            {withdrawal.phone.slice(0, 2)}***{withdrawal.phone.slice(-4)}
                          </span>
                        </div>
                        <div className="detail">
                          <span className="label">Дата:</span>
                          <span className="value">{formatDate(withdrawal.created_at)}</span>
                        </div>
                      </div>

                      {withdrawal.reviewed_at && withdrawal.admin_comment && (
                        <div className="admin-comment">
                          <strong>Комментарий администратора:</strong>
                          <p>{withdrawal.admin_comment}</p>
                        </div>
                      )}

                      {withdrawal.canceled_at && (
                        <div className="canceled-badge">Отменено</div>
                      )}

                      {canCancel && (
                        <button
                          className="btn-cancel"
                          onClick={() => handleCancelWithdrawal(withdrawal.id)}
                          disabled={cancelingId === withdrawal.id}
                        >
                          {cancelingId === withdrawal.id 
                            ? 'Отмена...' 
                            : `Отменить (${Math.ceil(secondsRemaining)}с)`}
                        </button>
                      )}

                      {isActive && !canCancel && (
                        <p className="info-small">
                          Отмена больше не доступна (прошло более 1 минуты)
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
