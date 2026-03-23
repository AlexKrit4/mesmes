import React, { useRef, useState, useEffect } from 'react';
import api from '../api';

const MAX_DURATION = 60;
const SWIPE_THRESHOLD = 50; // pixels up to trigger send

export default function TelegramVoiceRecorder({ recipientId = null, channelId = null, onSent = null }) {
  const [mode, setMode] = useState('voice'); // 'voice' or 'video'
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showVideoPreview, setShowVideoPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const pressStartRef = useRef({ time: 0, y: 0 });
  const initialTouchRef = useRef(null);
  const recordingButtonRef = useRef(null);

  // Cleanup: stop streams and clear timers
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Request camera permission when video mode is active
  useEffect(() => {
    if (mode !== 'video' || !showVideoPreview) return;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Camera error:', err);
        setShowVideoPreview(false);
      }
    })();

    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [mode, showVideoPreview]);

  const startRecording = async () => {
    if (mode === 'video' && !mediaStreamRef.current) return;
    if (mode === 'voice' && !mediaStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      } catch (err) {
        console.error('Microphone error:', err);
        return;
      }
    }

    chunksRef.current = [];
    audioChunksRef.current = [];

    if (mode === 'video') {
      // Video recording
      const mimeType = 'video/webm';
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType,
        videoBitsPerSecond: 1500000,
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onerror = (e) => {
        console.error('Video recording error:', e.error);
        setIsRecording(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
    } else {
      // Audio recording
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType: 'audio/webm',
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onerror = (e) => {
        console.error('Audio recording error:', e.error);
        setIsRecording(false);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
    }

    setIsRecording(true);
    setRecordingTime(0);

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => {
        const next = prev + 1;
        if (next >= MAX_DURATION) {
          finishRecording();
        }
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    clearInterval(timerRef.current);
    mediaRecorderRef.current.stop();
    setIsRecording(false);

    mediaRecorderRef.current.onstop = async () => {
      try {
        setIsUploading(true);
        const data = mode === 'video' ? chunksRef.current : audioChunksRef.current;
        const blob = new Blob(data, {
          type: mode === 'video' ? 'video/webm' : 'audio/webm',
        });

        if (blob.size === 0) {
          console.error('Recording blob is empty');
          setIsUploading(false);
          return;
        }

        const formData = new FormData();
        if (mode === 'video') {
          formData.append('voiceCircle', blob, `voice_circle_${Date.now()}.webm`);
          formData.append('duration', recordingTime);
          if (recipientId) formData.append('receiverId', recipientId);
          if (channelId) formData.append('channelId', channelId);
        } else {
          // Voice message - send as regular file
          formData.append('files', blob, `voice_msg_${Date.now()}.webm`);
        }

        const endpoint = mode === 'video'
          ? (recipientId ? '/users/voice-circles/file' : '/channels/:id/voice-circles/file')
          : '/users/messages/file';

        await api.post(endpoint, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });

        setShowVideoPreview(false);
        if (onSent) onSent();
        setIsUploading(false);
      } catch (err) {
        console.error('Upload error:', err);
        setIsUploading(false);
      }
    };
  };

  const finishRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const handleMouseDown = (e) => {
    pressStartRef.current = {
      time: Date.now(),
      y: e.clientY || e.touches?.[0]?.clientY,
    };
    initialTouchRef.current = {
      y: e.clientY || e.touches?.[0]?.clientY,
    };

    if (mode === 'video') {
      setShowVideoPreview(true);
    }

    // Small delay before starting recording (to distinguish from tap)
    setTimeout(() => {
      if (!isRecording && Date.now() - pressStartRef.current.time > 200) {
        startRecording();
      }
    }, 250);
  };

  const handleMouseUp = () => {
    pressStartRef.current = { time: 0, y: 0 };
    initialTouchRef.current = null;

    if (isRecording) {
      finishRecording();
    }

    if (mode === 'video') {
      setShowVideoPreview(false);
    }
  };

  const handleMouseMove = (e) => {
    if (!isRecording || !initialTouchRef.current) return;

    const currentY = e.clientY || e.touches?.[0]?.clientY;
    const deltaY = initialTouchRef.current.y - currentY;

    // If swiped up enough, send and cancel recording
    if (deltaY > SWIPE_THRESHOLD) {
      finishRecording();
      initialTouchRef.current = null;
    }
  };

  const formatTime = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="telegram-voice-recorder">
      {/* Mode selector buttons */}
      <div className="mode-selector">
        <button
          className={`mode-btn ${mode === 'voice' ? 'active' : ''}`}
          onClick={() => {
            if (!isRecording) setMode('voice');
          }}
          disabled={isRecording}
          title="Голосовое сообщение"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        </button>

        <button
          className={`mode-btn ${mode === 'video' ? 'active' : ''}`}
          onClick={() => {
            if (!isRecording) setMode('video');
          }}
          disabled={isRecording}
          title="Видео кружок"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><path d="M3.6 9.6A8 8 0 0 1 20.4 14.4"/>
          </svg>
        </button>
      </div>

      {/* Recording button (large) */}
      <button
        ref={recordingButtonRef}
        className={`record-btn ${isRecording ? 'recording' : ''} ${mode}`}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        onTouchMove={handleMouseMove}
        disabled={isUploading}
        title={isRecording ? 'Смахните вверх для отправки' : `Зажмите для ${mode === 'voice' ? 'голоса' : 'видео'}`}
      >
        {isRecording && (
          <div className="recording-time">{formatTime(recordingTime)}</div>
        )}
        {!isRecording && (
          <>
            {mode === 'voice' ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
              </svg>
            )}
          </>
        )}
      </button>

      {/* Video preview (for video mode) */}
      {showVideoPreview && mode === 'video' && (
        <div className="video-preview-overlay">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)', // Mirror effect
            }}
          />
          {isRecording && (
            <div className="recording-badge">
              <span className="recording-dot"></span>
              ЗАПИСЬ
            </div>
          )}
        </div>
      )}

      {/* Uploading indicator */}
      {isUploading && (
        <div className="uploading-indicator">
          <div className="spinner"></div>
          <p>Загрузка...</p>
        </div>
      )}
    </div>
  );
}
