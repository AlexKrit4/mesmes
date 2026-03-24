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
  const pendingRemoteCandidatesRef = useRef([]);

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

  // Register handlers for RTC answer and ICE candidates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const callData = JSON.parse(sessionStorage.getItem('activeCall') || '{}');
    const pc = window.currentPeerConnection;
    
    if (!pc) {
      console.log('❌ [CallPage] No peer connection found');
      return;
    }

    // Register connection state handlers on PC
    pc.onconnectionstatechange = () => {
      console.log('📡 [CallPage] Connection state:', pc.connectionState);
      if (pc.connectionState === 'connecting') setCallState('connecting');
      if (pc.connectionState === 'connected') setCallState('in-call');
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        setCallState('ended');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('🧊 [CallPage] ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        setCallState('in-call');
      }
      if (pc.iceConnectionState === 'failed') {
        console.error('❌ [CallPage] ICE connection failed');
        setCallState('ended');
      }
    };

    pc.ontrack = (event) => {
      console.log('🎵 [CallPage] Remote track received:', event.track.kind);
      if (remoteAudioRef.current) {
        if (!remoteAudioRef.current.srcObject) {
          remoteAudioRef.current.srcObject = new MediaStream();
        }
        const streamTracks = event.streams?.[0]?.getTracks?.() || [];
        const track = streamTracks[0] || event.track || null;
        if (track && !remoteAudioRef.current.srcObject.getTracks().some((t) => t.id === track.id)) {
          remoteAudioRef.current.srcObject.addTrack(track);
        }
        remoteAudioRef.current.play?.().catch(() => {});
      }
    };

    // Handle incoming answer
    const onCallAnswer = async ({ from, answer, callId }) => {
      console.log('📞 [CallPage] onCallAnswer received:', { from, callId, hasPC: !!pc });
      
      if (!answer || !callId || !pc) {
        console.log('❌ [CallPage] Missing answer, callId, or PC');
        return;
      }

      try {
        console.log('📞 [CallPage] Setting remote description from answer...');
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('📞 [CallPage] Remote description set, processing ICE candidates...');
        
        for (const candidate of pendingRemoteCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingRemoteCandidatesRef.current = [];
        setCallState('connecting');
      } catch (err) {
        console.error('❌ Call answer error:', err);
        setCallState('ended');
      }
    };

    // Handle incoming ICE candidates
    const onCallIceCandidate = async ({ from, candidate, callId }) => {
      if (!callId || !pc) return;
      if (!candidate) return;

      try {
        console.log('🧊 [CallPage] Adding remote ICE candidate');
        if (pc.remoteDescription?.type) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          console.log('🧊 [CallPage] Remote description not set yet, queuing candidate...');
          pendingRemoteCandidatesRef.current.push(candidate);
        }
      } catch (err) {
        console.error('🧊 ICE candidate error:', err);
      }
    };

    socket.on('call_answer', onCallAnswer);
    socket.on('call_ice_candidate', onCallIceCandidate);

    return () => {
      socket.off('call_answer', onCallAnswer);
      socket.off('call_ice_candidate', onCallIceCandidate);
    };
  }, []);

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
    
    // Close peer connection when ending call
    const pc = window.currentPeerConnection;
    if (pc) {
      pc.close();
      window.currentPeerConnection = null;
    }
    
    navigate(`/chat/${friendId}`);
    sessionStorage.removeItem('activeCall');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const pc = window.currentPeerConnection;
      if (pc) {
        try {
          pc.close();
        } catch (e) {
          console.log('PC already closed');
        }
        window.currentPeerConnection = null;
      }
    };
  }, []);

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
