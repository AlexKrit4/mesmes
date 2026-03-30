import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './CasinoSlot.css';
import CasinoSlotGame from './CasinoSlotGame';
import DepositModal from './CasinoModals/DepositModal';
import WithdrawalModal from './CasinoModals/WithdrawalModal';
import HistoryModal from './CasinoModals/HistoryModal';
import api from '../api';

export default function CasinoSlot() {
  const navigate = useNavigate();
  const [balance, setBalance] = useState(0);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdrawal, setShowWithdrawal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchBalance = async () => {
    try {
      const response = await api.get('/casino/balance');
      setBalance(response.data.balance);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load balance');
      setLoading(false);
    }
    setLoading(false);
  };

  const handleExitClick = () => {
    navigate('/settings');
  };

  const handleSpinComplete = () => {
    fetchBalance();
  };

  if (loading) {
    return <div className="casino-page">Загрузка...</div>;
  }

  if (error && error.includes('No slot access')) {
    return (
      <div className="casino-page">
        <div className="casino-no-access">
          <h2>Доступ к казино не предоставлен</h2>
          <p>Обратитесь к администратору для получения доступа</p>
          <button onClick={handleExitClick}>Назад в настройки</button>
        </div>
      </div>
    );
  }

  return (
    <div className="casino-page">
      <div className="casino-header">
        <div className="casino-title">🎰 КАЗИНО</div>
        <div className="casino-balance">
          Баланс: <span className="balance-amount">{balance.toFixed(2)} ₽</span>
        </div>
        <div className="casino-buttons">
          <button className="btn-casino" onClick={() => setShowDeposit(true)}>
            💰 Пополнить
          </button>
          <button className="btn-casino" onClick={() => setShowWithdrawal(true)}>
            💸 Вывести
          </button>
          <button className="btn-casino" onClick={() => setShowHistory(true)}>
            📋 История
          </button>
          <button className="btn-exit" onClick={handleExitClick}>
            Выйти
          </button>
        </div>
      </div>

      <CasinoSlotGame onSpinComplete={handleSpinComplete} balance={balance} />

      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onSuccess={() => {
            setShowDeposit(false);
            fetchBalance();
          }}
        />
      )}

      {showWithdrawal && (
        <WithdrawalModal
          onClose={() => setShowWithdrawal(false)}
          balance={balance}
          onSuccess={() => {
            setShowWithdrawal(false);
            fetchBalance();
          }}
        />
      )}

      {showHistory && (
        <HistoryModal
          onClose={() => setShowHistory(false)}
          onWithdrawalCanceled={fetchBalance}
        />
      )}
    </div>
  );
}
