import React, { useEffect, useState } from 'react';
import api from '../api';

export default function CasinoWithdrawalsAdmin() {
  const [withdrawals, setWithdrawals] = useState([]);
  const [selectedWithdrawal, setSelectedWithdrawal] = useState(null);
  const [adminComment, setAdminComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchWithdrawals();
    const interval = setInterval(fetchWithdrawals, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchWithdrawals = async () => {
    try {
      const response = await api.get('/casino/admin/withdrawals');
      setWithdrawals(response.data.withdrawals);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching withdrawals:', error);
      setLoading(false);
    }
  };

  const handleSelectWithdrawal = async (id) => {
    try {
      const response = await api.get(`/casino/admin/withdrawal/${id}`);
      setSelectedWithdrawal(response.data.withdrawal);
      setAdminComment('');
      setMessage('');
    } catch (error) {
      setMessage('Ошибка загрузки заявки: ' + error.response?.data?.error);
    }
  };

  const handleApprove = async () => {
    if (!selectedWithdrawal) return;

    setProcessing(true);
    try {
      await api.patch(`/casino/admin/withdrawal/${selectedWithdrawal.id}/approve`, {
        adminComment,
      });

      setMessage('✅ Заявка одобрена');
      setTimeout(() => {
        setSelectedWithdrawal(null);
        fetchWithdrawals();
      }, 1000);
    } catch (error) {
      setMessage('Ошибка: ' + error.response?.data?.error);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedWithdrawal) return;

    setProcessing(true);
    try {
      await api.patch(`/casino/admin/withdrawal/${selectedWithdrawal.id}/reject`, {
        adminComment,
      });

      setMessage('❌ Заявка отклонена');
      setTimeout(() => {
        setSelectedWithdrawal(null);
        fetchWithdrawals();
      }, 1000);
    } catch (error) {
      setMessage('Ошибка: ' + error.response?.data?.error);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return <div className="admin-section">Загрузка...</div>;
  }

  return (
    <div className="admin-section">
      <h2>💸 Управление выводами казино</h2>

      {selectedWithdrawal ? (
        <div className="withdrawal-detail">
          <button 
            className="btn-back"
            onClick={() => setSelectedWithdrawal(null)}
          >
            ← Назад к списку
          </button>

          <div className="withdrawal-info">
            <h3>Заявка #{selectedWithdrawal.id}</h3>

            <div className="info-row">
              <span className="label">Пользователь:</span>
              <span className="value">
                {selectedWithdrawal.username} (@{selectedWithdrawal.public_id})
              </span>
            </div>

            <div className="info-row">
              <span className="label">Сумма:</span>
              <span className="value">{selectedWithdrawal.amount.toFixed(2)} ₽</span>
            </div>

            <div className="info-row">
              <span className="label">Банк:</span>
              <span className="value">{selectedWithdrawal.bank.toUpperCase()}</span>
            </div>

            <div className="info-row">
              <span className="label">Номер телефона:</span>
              <span className="value">{selectedWithdrawal.phone}</span>
            </div>

            <div className="info-row">
              <span className="label">Дата заявки:</span>
              <span className="value">
                {new Date(selectedWithdrawal.created_at).toLocaleString('ru-RU')}
              </span>
            </div>

            <div className="info-row">
              <span className="label">Статус:</span>
              <span className="value" style={{
                color: selectedWithdrawal.status === 'pending' ? '#ffed4e' : (selectedWithdrawal.status === 'approved' ? '#28d9aa' : '#ff6b6b'),
                fontWeight: 'bold'
              }}>
                {selectedWithdrawal.status === 'pending' ? '⏳ В ожидании' : (selectedWithdrawal.status === 'approved' ? '✅ Одобрена' : '❌ Отклонена')}
              </span>
            </div>

            {selectedWithdrawal.status === 'pending' && (
              <div style={{
                padding: '10px',
                background: 'rgba(100, 180, 255, 0.15)',
                border: '1px solid rgba(100, 180, 255, 0.3)',
                borderRadius: '4px',
                color: '#64b4ff',
                fontSize: '13px',
                marginTop: '10px'
              }}>
                ℹ️ Пользователь может отменить этот вывод в течение <strong>1 минуты</strong> в своей истории операций. Вы можете одобрить заявку - деньги будут выведены, но пользователь всё ещё сможет отменить.
              </div>
            )}

            {selectedWithdrawal.admin_comment && (
              <div className="info-row">
                <span className="label">Комментарий администратора:</span>
                <span className="value">{selectedWithdrawal.admin_comment}</span>
              </div>
            )}

            <div className="form-group">
              <label>Комментарий администратора:</label>
              <textarea
                value={adminComment}
                onChange={(e) => setAdminComment(e.target.value)}
                placeholder="Оставьте комментарий (опционально)"
                rows="4"
                disabled={processing || selectedWithdrawal.status !== 'pending'}
              />
            </div>

            {message && (
              <div className={message.includes('✅') ? 'message-success' : 'message-error'}>
                {message}
              </div>
            )}

            {selectedWithdrawal.status === 'pending' && (
              <div className="action-buttons">
                <button
                  className="btn-approve"
                  onClick={handleApprove}
                  disabled={processing}
                >
                  {processing ? 'Обработка...' : '✅ Одобрить'}
                </button>
                <button
                  className="btn-reject"
                  onClick={handleReject}
                  disabled={processing}
                >
                  {processing ? 'Обработка...' : '❌ Отклонить'}
                </button>
              </div>
            )}
            {selectedWithdrawal.status !== 'pending' && (
              <div style={{
                padding: '12px',
                background: 'rgba(255, 215, 0, 0.1)',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                borderRadius: '4px',
                color: '#ffed4e',
                textAlign: 'center',
                fontSize: '14px'
              }}>
                Заявка рассмотрена. Дальнейшие действия недоступны.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="withdrawals-list">
          {withdrawals.length === 0 ? (
            <p style={{ textAlign: 'center', opacity: 0.6 }}>
              Нет заявок на вывод
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Пользователь</th>
                  <th>Сумма</th>
                  <th>Банк</th>
                  <th>Телефон</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id}>
                    <td>#{w.id}</td>
                    <td>{w.username}</td>
                    <td>{w.amount.toFixed(2)} ₽</td>
                    <td>{w.bank.toUpperCase()}</td>
                    <td>{w.phone}</td>
                    <td>{new Date(w.created_at).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}</td>
                    <td style={{
                      color: w.status === 'pending' ? '#ffed4e' : (w.status === 'approved' ? '#28d9aa' : '#ff6b6b'),
                      fontWeight: 'bold'
                    }}>
                      {w.status === 'pending' ? '⏳ В ожидании' : (w.status === 'approved' ? '✅ Рассмотрена' : '❌ Отклонена')}
                    </td>
                    <td>
                      <button
                        className="btn-small"
                        onClick={() => handleSelectWithdrawal(w.id)}
                      >
                        {w.status === 'pending' ? 'Рассмотреть' : 'Просмотр'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <style>{`
        .withdrawal-detail {
          background: var(--bg2);
          padding: 20px;
          border-radius: 8px;
        }

        .btn-back {
          background: rgba(100, 150, 200, 0.2);
          color: #6496c8;
          border: 1px solid #6496c8;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          margin-bottom: 20px;
          font-size: 14px;
        }

        .btn-back:hover {
          background: rgba(100, 150, 200, 0.3);
        }

        .withdrawal-info {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .withdrawal-info h3 {
          color: var(--accent);
          margin: 0;
        }

        .info-row {
          display: flex;
          justify-content: space-between;
          padding: 10px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 4px;
        }

        .info-row .label {
          font-weight: 600;
          color: var(--text2);
        }

        .info-row .value {
          text-align: right;
        }

        .info-row .value {
          color: var(--text);
          font-family: monospace;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-weight: 600;
          color: var(--text2);
        }

        .form-group textarea {
          padding: 10px;
          background: var(--bg3);
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--text);
          font-family: inherit;
          resize: vertical;
        }

        .form-group textarea:focus {
          outline: none;
          border-color: var(--accent);
        }

        .form-group textarea:disabled {
          opacity: 0.5;
        }

        .message-success {
          background: rgba(32, 201, 151, 0.2);
          color: #28d9aa;
          border: 1px solid #28d9aa;
          padding: 10px;
          border-radius: 4px;
        }

        .message-error {
          background: rgba(255, 99, 71, 0.2);
          color: #ff6347;
          border: 1px solid #ff6347;
          padding: 10px;
          border-radius: 4px;
        }

        .action-buttons {
          display: flex;
          gap: 10px;
        }

        .btn-approve,
        .btn-reject {
          flex: 1;
          padding: 12px 20px;
          border: none;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .btn-approve {
          background: rgba(32, 201, 151, 0.2);
          color: #28d9aa;
          border: 1px solid #28d9aa;
        }

        .btn-approve:hover:not(:disabled) {
          background: rgba(32, 201, 151, 0.3);
        }

        .btn-reject {
          background: rgba(255, 99, 71, 0.2);
          color: #ff6347;
          border: 1px solid #ff6347;
        }

        .btn-reject:hover:not(:disabled) {
          background: rgba(255, 99, 71, 0.3);
        }

        .btn-approve:disabled,
        .btn-reject:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 600px;
        }

        .admin-table th {
          background: var(--bg3);
          padding: 12px;
          text-align: left;
          font-weight: 600;
          border-bottom: 2px solid var(--border);
          white-space: nowrap;
        }

        .admin-table td {
          padding: 12px;
          border-bottom: 1px solid var(--border);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .withdrawals-list {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        @media (max-width: 768px) {
          .admin-table th,
          .admin-table td {
            padding: 8px 6px;
            font-size: 13px;
          }

          .btn-small {
            padding: 4px 8px;
            font-size: 11px;
          }

          .admin-table {
            min-width: 500px;
          }
        }

        .admin-table tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .btn-small {
          background: var(--accent);
          color: #000;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .btn-small:hover {
          opacity: 0.8;
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  );
}
