import React, { useState, useEffect } from 'react';
import api from '../api';

export default function CasinoAccessAdmin() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [grantUserId, setGrantUserId] = useState('');
  const [grantBalance, setGrantBalance] = useState('100');
  const [grantMsg, setGrantMsg] = useState('');

  useEffect(() => {
    fetchAccessList();
  }, []);

  const fetchAccessList = async () => {
    try {
      const { data } = await api.get('/casino/admin/access-list');
      setUsers(data.users);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users');
    }
    setLoading(false);
  };

  const handleGrantAccess = async () => {
    if (!grantUserId || !grantBalance) {
      setGrantMsg('Please fill all fields');
      return;
    }

    try {
      await api.post('/casino/admin/grant-access', {
        userId: parseInt(grantUserId),
        initialBalance: parseFloat(grantBalance),
      });
      setGrantMsg('✓ Access granted');
      setGrantUserId('');
      setGrantBalance('100');
      setTimeout(() => setGrantMsg(''), 3000);
      fetchAccessList();
    } catch (err) {
      setGrantMsg(err.response?.data?.error || 'Failed to grant access');
    }
  };

  const handleRevokeAccess = async (userId) => {
    if (!window.confirm('Are you sure you want to revoke casino access?')) return;

    try {
      await api.post('/casino/admin/revoke-access', { userId });
      setGrantMsg('✓ Access revoked');
      setTimeout(() => setGrantMsg(''), 3000);
      fetchAccessList();
    } catch (err) {
      setGrantMsg(err.response?.data?.error || 'Failed to revoke access');
    }
  };

  const filteredUsers = users.filter(u =>
    u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.public_id?.includes(searchQuery)
  );

  if (loading) return <div style={{ padding: '20px' }}>Loading...</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h2>🎰 Casino Access Management</h2>

      {/* Grant Access Section */}
      <div style={{
        backgroundColor: '#1a1a1a',
        padding: '15px',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #333',
      }}>
        <h3>Grant Casino Access</h3>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="User ID"
            value={grantUserId}
            onChange={(e) => setGrantUserId(e.target.value)}
            style={{
              padding: '10px',
              backgroundColor: '#222',
              border: '1px solid #444',
              color: '#fff',
              borderRadius: '4px',
              flex: '1',
              minWidth: '120px',
            }}
          />
          <input
            type="number"
            placeholder="Initial Balance (₽)"
            value={grantBalance}
            onChange={(e) => setGrantBalance(e.target.value)}
            min="0"
            step="10"
            style={{
              padding: '10px',
              backgroundColor: '#222',
              border: '1px solid #444',
              color: '#fff',
              borderRadius: '4px',
              flex: '1',
              minWidth: '120px',
            }}
          />
          <button
            onClick={handleGrantAccess}
            style={{
              padding: '10px 20px',
              backgroundColor: '#0088cc',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Grant Access
          </button>
        </div>
        {grantMsg && (
          <div style={{
            color: grantMsg.includes('✓') ? '#4a4' : '#f44',
            fontSize: '14px',
            marginTop: '10px',
          }}>
            {grantMsg}
          </div>
        )}
      </div>

      {/* Users with Casino Access */}
      <div>
        <h3>Users with Casino Access ({filteredUsers.length})</h3>
        <input
          type="text"
          placeholder="Search by username or ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '10px',
            width: '100%',
            marginBottom: '15px',
            backgroundColor: '#222',
            border: '1px solid #444',
            color: '#fff',
            borderRadius: '4px',
            boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{ color: '#f44', marginBottom: '10px' }}>
            {error}
          </div>
        )}

        {filteredUsers.length === 0 ? (
          <div style={{ color: '#888', padding: '20px', textAlign: 'center' }}>
            No users with casino access
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gap: '10px',
            maxHeight: '600px',
            overflowY: 'auto',
          }}>
            {filteredUsers.map((user) => (
              <div
                key={user.id}
                style={{
                  backgroundColor: '#222',
                  padding: '15px',
                  borderRadius: '8px',
                  border: '1px solid #333',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '15px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                    {user.username || 'Unknown'}
                  </div>
                  <div style={{ color: '#888', fontSize: '12px' }}>
                    ID: {user.public_id} | Balance: {user.casino_balance?.toFixed(2)} ₽
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeAccess(user.id)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#f44',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
