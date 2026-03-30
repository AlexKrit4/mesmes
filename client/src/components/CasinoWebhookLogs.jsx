import React, { useEffect, useState } from 'react';
import api from '../api';

export default function CasinoWebhookLogs() {
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchLogs();
    
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const fetchLogs = async () => {
    try {
      const response = await api.get('/casino/admin/webhook-logs');
      setLogs(response.data.logs);
      setLoading(false);
    } catch (error) {
      setLogs(`Error loading logs: ${error.response?.data?.error || error.message}`);
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Yoomoney Webhook Logs</h2>

      <div style={{ marginBottom: '15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button
          onClick={fetchLogs}
          style={{
            padding: '8px 16px',
            backgroundColor: '#0088cc',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          🔄 Обновить
        </button>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span>Авто-обновление каждые 5 сек</span>
        </label>
      </div>

      {loading ? (
        <div>Загрузка логов...</div>
      ) : (
        <pre
          style={{
            backgroundColor: '#1a1a1a',
            color: '#0f0',
            padding: '15px',
            borderRadius: '8px',
            overflow: 'auto',
            maxHeight: '600px',
            fontSize: '12px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            border: '1px solid #333',
          }}
        >
          {logs || 'No logs yet'}
        </pre>
      )}

      <div style={{ marginTop: '15px', fontSize: '12px', color: '#888' }}>
        💡 Логи обновляются в реальном времени. Смотрите события платежей Yoomoney здесь.
      </div>
    </div>
  );
}
