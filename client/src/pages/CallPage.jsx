import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSocket } from '../socket.js';
import '../styles/CallPage.css';

export default function CallPage() {
  const { friendId } = useParams();
  const navigate = useNavigate();
  const [friend, setFriend] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMicOn, setIsMicOn] = useState(true);
  const [callState, setCallState] = useState('connecting'); // connecting, in-call, ended
  const timerRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    // Получи информацию о друге из localStorage (передалась при инициировании звонка)
    const callData = JSON.parse(sessionStorage.getItem('activeCall') || '{}');
    if (callData.friendId) {
      setFriend(callData.friend);
    }

    // Запусти таймер
    timerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Обновляй статус звонка
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleConnectionStateChange = (state) => {
      setCallState(state);
      if (state === 'ended') {
        setTimeout(() => {
          navigate(`/chat/${friendId}`);
          sessionStorage.removeItem('activeCall');
        }, 1500);
      }
    };

    socket.on('callStateChanged', handleConnectionStateChange);
    return () => socket.off('callStateChanged', handleConnectionStateChange);
  }, [friendId, navigate]);

  const toggleMicrophone = () => {
    const socket = getSocket();
    if (!socket) return;

    setIsMicOn((prev) => {
      const newState = !prev;
      socket.emit('toggle_microphone', { micOn: newState });
      return newState;
    });
  };

  const endCall = () => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('end_call', { to: friendId });
    navigate(`/chat/${friendId}`);
    sessionStorage.removeItem('activeCall');
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="call-page">
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="call-container">
        {/* Информация о контакте */}
        <div className="call-info">
          <div className="friend-avatar">
            {friend?.avatar ? (
              <img src={friend.avatar} alt={friend.name} />
            ) : (
              <div className="avatar-placeholder">
                {friend?.name?.charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          <h2 className="friend-name">{friend?.name || 'Звонящий'}</h2>

          <div className={`call-status ${callState}`}>
            {callState === 'connecting' && 'Соединяем...'}
            {callState === 'in-call' && 'В разговоре'}
            {callState === 'ended' && 'Завершён'}
          </div>

          <div className="call-duration">{formatTime(callDuration)}</div>
        </div>

        {/* Кнопки управления */}
        <div className="call-controls">
          <button
            className={`control-btn microphone-btn ${isMicOn ? 'on' : 'off'}`}
            onClick={toggleMicrophone}
            title={isMicOn ? 'Выключить микрофон' : 'Включить микрофон'}
          >
            <span className="icon">
              {isMicOn ? '🎤' : '🔇'}
            </span>
            <span className="label">{isMicOn ? 'Микрофон' : 'Микрофон'}</span>
          </button>

          <button
            className="control-btn end-call-btn"
            onClick={endCall}
            title="Завершить звонок"
          >
            <span className="icon">📞</span>
            <span className="label">Завершить</span>
          </button>
        </div>
      </div>
    </div>
  );
}
