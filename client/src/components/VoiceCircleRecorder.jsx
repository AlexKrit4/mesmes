import React, { useRef, useState, useEffect } from 'react';
import api from '../api';

const MAX_DURATION = 60; // seconds

export default function VoiceCircleRecorder({ isOpen, onClose, onSend, recipientId = null, channelId = null }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [hasPermission, setHasPermission] = useState(null);
  
  const timerRef = useRef(null);

  // Request camera permission and start preview
  useEffect(() => {
    if (!isOpen) return;
    
    (async () => {
      try {
        setError(null);
        setHasPermission(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
        
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHasPermission(true);
      } catch (err) {
        console.error('Camera error:', err);
        setHasPermission(false);
        setError('Нет доступа к камере. Проверьте разрешения.');
      }
    })();
    
    return () => {
      // Cleanup: stop all tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      clearTimeout(timerRef.current);
    };
  }, [isOpen]);

  const startRecording = async () => {
    if (!mediaStreamRef.current) return;
    
    try {
      chunksRef.current = [];
      const mimeType = 'video/webm';
      
      const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType,
        videoBitsPerSecond: 1500000, // 1.5 Mbps for quality
      });
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onerror = (e) => {
        setError(`Ошибка записи: ${e.error}`);
        setIsRecording(false);
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      
      // Auto-stop at MAX_DURATION
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          const next = prev + 1;
          if (next >= MAX_DURATION) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      setError(`Ошибка записи: ${err.message}`);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    
    clearInterval(timerRef.current);
    mediaRecorderRef.current.stop();
    setIsRecording(false);
    
    // Get blob after recording stops
    mediaRecorderRef.current.onstop = async () => {
      try {
        setIsUploading(true);
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const duration = recordingTime;
        
        // Upload to server
        const formData = new FormData();
        formData.append('voiceCircle', blob, `voice_circle_${Date.now()}.webm`);
        formData.append('duration', duration);
        if (recipientId) formData.append('receiverId', recipientId);
        if (channelId) formData.append('channelId', channelId);
        
        const endpoint = recipientId 
          ? '/users/voice-circles/file'
          : '/channels/voice-circles/file';
        
        await api.post(endpoint, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        
        // Close modal and notify parent
        onClose();
        if (onSend) onSend();
        
        setIsUploading(false);
      } catch (err) {
        console.error('Upload error:', err);
        setError(`Ошибка загрузки: ${err.response?.data?.error || err.message}`);
        setIsUploading(false);
      }
    };
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      clearInterval(timerRef.current);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingTime(0);
    }
    chunksRef.current = [];
  };

  if (!isOpen) return null;

  const progress = (recordingTime / MAX_DURATION) * 100;

  return (
    <div className="modal-overlay" onClick={() => !isRecording && !isUploading && onClose()}>
      <div className="voice-circle-recorder" onClick={e => e.stopPropagation()}>
        <div className="recorder-header">
          <h3>Голосовой кружок</h3>
          <button className="close-btn" onClick={() => !isRecording && !isUploading && onClose()}>✕</button>
        </div>

        {hasPermission === false && (
          <div className="recorder-error">
            <p>❌ {error}</p>
            <button onClick={() => onClose()} className="btn btn-primary">Закрыть</button>
          </div>
        )}

        {hasPermission && (
          <>
            <div className="recorder-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '300px',
                  objectFit: 'cover',
                  borderRadius: '12px',
                  backgroundColor: '#000',
                }}
              />
              {isRecording && (
                <div className="recording-indicator">
                  <span className="recording-dot"></span>
                  <span>{Math.floor(recordingTime)}s / {MAX_DURATION}s</span>
                </div>
              )}
            </div>

            {isRecording && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
            )}

            {error && (
              <div className="recorder-error">
                <p>⚠️ {error}</p>
              </div>
            )}

            <div className="recorder-controls">
              {!isRecording ? (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={onClose}
                    disabled={isUploading}
                  >
                    Отмена
                  </button>
                  <button
                    className="btn btn-record"
                    onClick={startRecording}
                    disabled={isUploading}
                  >
                    🎥 Начать
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={cancelRecording}
                    disabled={isUploading}
                  >
                    Отмена
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={stopRecording}
                    disabled={isUploading}
                  >
                    ⏹️ Готово
                  </button>
                </>
              )}
            </div>

            {isUploading && (
              <div className="uploading-status">
                <div className="spinner"></div>
                <p>Загрузка...</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
