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
  const [debugInfo, setDebugInfo] = useState({ 
    micAccess: '⏳ Запрашиваю микрофон...',
    localTracks: 0,
    remoteTracks: 0,
    iceState: '⏳ Инициализация...',
    connectionState: '⏳ Подключаюсь...'
  });
  const timerRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pendingRemoteCandidatesRef = useRef([]);

  console.log('🎬 [CallPage] COMPONENT RENDER with friendId:', friendId);

  // Track mounts and unmounts with stack trace
  useEffect(() => {
    console.log('🎬 [CallPage] COMPONENT MOUNTED with friendId:', friendId);
    console.trace('🎯 [CallPage] Mount trace');
    return () => {
      console.log('🎬 [CallPage] COMPONENT UNMOUNTING');
    };
  }, [friendId]);

  // Получи информацию о друге из localStorage (передалась при инициировании звонка)
  useEffect(() => {
    const callData = JSON.parse(sessionStorage.getItem('activeCall') || '{}');
    console.log('👥 [CallPage] Loading call data:', { friendId: callData.friendId, hasFriend: !!callData.friend, friend: callData.friend });
    if (callData.friendId) {
      console.log('✅ [CallPage] Setting friend:', callData.friend);
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

  // Периодически обновляй информацию о микрофоне и треках
  useEffect(() => {
    const updateDebugInfo = () => {
      const pc = window.currentPeerConnection;
      if (!pc) return;
      
      // Получи информацию о локальных треках
      const senders = pc.getSenders();
      const audioSenders = senders.filter(sender => sender.track?.kind === 'audio');
      const micAccessible = audioSenders.length > 0;
      
      let micStatus = '❌ Микрофон не подключен';
      if (micAccessible) {
        const trackStatus = audioSenders.map(s => {
          const track = s.track;
          const status = track?.enabled ? '✅' : '❌';
          return `${status} ${track?.readyState || 'unknown'}`;
        }).join(', ');
        micStatus = `✅ Микрофон (${audioSenders.length} трек): ${trackStatus}`;
      }
      
      setDebugInfo(prev => ({
        ...prev,
        micAccess: micStatus
      }));
    };

    const interval = setInterval(updateDebugInfo, 500);
    updateDebugInfo();
    return () => clearInterval(interval);
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
  }, [friendId]); // Only depend on friendId, navigate is stable

  // Register handlers for RTC answer and ICE candidates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      console.error('❌ [CallPage] Socket not available');
      return;
    }

    console.log('📡 [CallPage] Socket available, ID:', socket.id);

    const callData = JSON.parse(sessionStorage.getItem('activeCall') || '{}');
    const pc = window.currentPeerConnection;
    
    if (!pc) {
      console.log('❌ [CallPage] No peer connection found');
      return;
    }

    console.log('✅ [CallPage] Registering RTC handlers | Current state - Signaling:', pc.signalingState, '| ICE:', pc.iceConnectionState, '| Connection:', pc.connectionState);

    // Register connection state handlers on PC
    pc.onconnectionstatechange = () => {
      console.log('📡 [CallPage] ⚠️ CONNECTION STATE:', pc.connectionState, '| ICE:', pc.iceConnectionState, '| Signaling:', pc.signalingState);
      console.log('📡 [CallPage] Senders:', pc.getSenders().length, '| Receivers:', pc.getReceivers().length);
      setDebugInfo(prev => ({ ...prev, connectionState: `📡 ${pc.connectionState}` }));
      if (pc.connectionState === 'connecting') setCallState('connecting');
      if (pc.connectionState === 'connected') setCallState('in-call');
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        setCallState('ended');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('🧊 [CallPage] ⚠️ ICE STATE:', pc.iceConnectionState, '| Connection:', pc.connectionState, '| Signaling:', pc.signalingState);
      console.log('🧊 [CallPage] Senders:', pc.getSenders().length, '| Receivers:', pc.getReceivers().length);
      setDebugInfo(prev => ({ ...prev, iceState: `🧊 ${pc.iceConnectionState}` }));
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log('✅ [CallPage] ICE connected!');
        setCallState('in-call');
      }
      if (pc.iceConnectionState === 'failed') {
        console.error('❌ [CallPage] ICE connection FAILED!');
        setCallState('ended');
      }
    };

    pc.ontrack = (event) => {
      console.log('🎵 [CallPage] Remote track received:', event.track.kind, 'enabled:', event.track.enabled, 'readyState:', event.track.readyState);
      console.log('🎵 [CallPage] Track streams:', event.streams.length);
      
      setDebugInfo(prev => ({ ...prev, remoteTracks: 1 }));
      
      if (remoteAudioRef.current) {
        console.log('🎵 [CallPage] Setting up audio element, current srcObject:', remoteAudioRef.current.srcObject);
        if (!remoteAudioRef.current.srcObject) {
          remoteAudioRef.current.srcObject = new MediaStream();
        }
        const streamTracks = event.streams?.[0]?.getTracks?.() || [];
        const track = streamTracks[0] || event.track || null;
        console.log('🎵 [CallPage] Adding track to stream:', track?.kind, 'existing tracks:', remoteAudioRef.current.srcObject?.getTracks().length);
        if (track && !remoteAudioRef.current.srcObject.getTracks().some((t) => t.id === track.id)) {
          remoteAudioRef.current.srcObject.addTrack(track);
          console.log('🎵 [CallPage] Track added, total tracks now:', remoteAudioRef.current.srcObject.getTracks().length);
        }
        try {
          remoteAudioRef.current.play?.();
          console.log('✅ [CallPage] Audio playback started');
          setDebugInfo(prev => ({ ...prev, remoteTracks: remoteAudioRef.current.srcObject.getTracks().length }));
        } catch (err) {
          console.error('❌ [CallPage] Audio playback failed:', err);
        }
      }
    };

    // Handle incoming answer
    const onCallAnswer = async ({ from, answer, callId }) => {
      console.log('� [CallPage] ⚠️ onCallAnswer CALLED with:', { from, callId, hasAnswer: !!answer, hasPC: !!pc, socketId: socket?.id });
      console.log('�📞 [CallPage] onCallAnswer received:', { from, callId, hasPC: !!pc });
      
      if (!answer || !callId || !pc) {
        console.log('❌ [CallPage] Missing answer, callId, or PC');
        return;
      }

      try {
        console.log('� RECEIVED ANSWER SDP (first 800 chars):', answer.sdp.substring(0, 800));
        console.log('📡 RECEIVED ANSWER media section:', answer.sdp.includes('m=audio') ? '✅ Has m=audio' : '❌ NO m=audio');
        console.log('🔄 [BEFORE setRemoteDescription] Signaling:', pc.signalingState, '| ICE:', pc.iceConnectionState, '| Connection:', pc.connectionState);
        console.log('📞 [CallPage] Setting remote description from answer...');
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('🔄 [AFTER setRemoteDescription] Signaling:', pc.signalingState, '| ICE:', pc.iceConnectionState, '| Connection:', pc.connectionState);
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
    
    console.log('✅ [CallPage] Socket listeners registered for call_answer and call_ice_candidate (Socket ID:', socket.id, ')');

    // If PC already has both descriptions (answerer side scenario), manually update UI
    console.log('🔍 [CallPage] Checking if already connected...');
    if (pc.signalingState === 'stable' && pc.localDescription && pc.remoteDescription) {
      console.log('📡 [CallPage] ✅ PC already has both descriptions, manually triggering state checks');
      setDebugInfo(prev => ({ ...prev, connectionState: `📡 ${pc.connectionState}`, iceState: `🧊 ${pc.iceConnectionState}` }));
      
      // Check if we should be in-call
      if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log('✅ [CallPage] Already in connected state, moving to in-call');
        setCallState('in-call');
      } else if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
        console.error('❌ [CallPage] PC already in failed state');
        setCallState('ended');
      }
    }

    return () => {
      console.log('🧹 [CallPage] Cleaning up socket listeners');
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

        {/* Debug info panel */}
        <div style={{
          marginTop: '20px',
          padding: '12px',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '8px',
          fontSize: '12px',
          color: '#fff',
          textAlign: 'left',
          fontFamily: 'monospace'
        }}>
          <div style={{ marginBottom: '6px' }}>{debugInfo.micAccess}</div>
          <div style={{ marginBottom: '6px' }}>🎵 Удаленный звук: {debugInfo.remoteTracks > 0 ? `✅ ${debugInfo.remoteTracks} трек` : '❌ ждет'}</div>
          <div style={{ marginBottom: '6px' }}>{debugInfo.iceState}</div>
          <div>{debugInfo.connectionState}</div>
        </div>
      </div>
    </div>
  );
}
