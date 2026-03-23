import React, { useRef, useState, useEffect } from 'react';

const MAX_DURATION = 60;

export default function SimpleVoiceRecorder({ mode = 'voice', onSend, onCancel }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedMode, setRecordedMode] = useState(mode);

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const videoRef = useRef(null);
  const cancelAfterStopRef = useRef(false);

  // Cleanup
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Init camera for video mode
  useEffect(() => {
    setError(null);
    if (mode !== 'video') return;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
        mediaStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error('Camera error:', err);
        setError('Нет доступа к камере');
      }
    })();

    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [mode]);

  useEffect(() => {
    if (mode === 'video' && videoRef.current && mediaStreamRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [mode, isRecording]);

  const startRecording = async () => {
    if (mode === 'video' && !mediaStreamRef.current) return;
    if (mode === 'voice' && !mediaStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      } catch (err) {
        console.error('Microphone error:', err);
        setError('Нет доступа к микрофону');
        return;
      }
    }

    chunksRef.current = [];
    cancelAfterStopRef.current = false;
    setRecordedBlob(null);
    setRecordedMode(mode);
    setError(null);

    const currentMode = mode;
    const mimeType = currentMode === 'video' ? 'video/webm' : 'audio/webm';
    const mediaRecorder = new MediaRecorder(mediaStreamRef.current, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.onerror = (e) => {
      console.error('Recording error:', e.error);
      setError('Ошибка записи');
      setIsRecording(false);
    };

    mediaRecorder.onstop = () => {
      clearInterval(timerRef.current);
      timerRef.current = null;

      const shouldCancel = cancelAfterStopRef.current;
      cancelAfterStopRef.current = false;

      setIsRecording(false);

      if (shouldCancel) {
        chunksRef.current = [];
        setRecordedBlob(null);
        setRecordingTime(0);
        return;
      }

      const blob = new Blob(chunksRef.current, {
        type: currentMode === 'video' ? 'video/webm' : 'audio/webm',
      });

      chunksRef.current = [];
      if (blob.size > 0) {
        setRecordedBlob(blob);
        setRecordedMode(currentMode);
      } else {
        setError('Не удалось получить запись');
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);
    setRecordingTime(0);

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => {
        const next = prev + 1;
        if (next >= MAX_DURATION) {
          stopRecording();
        }
        return next;
      });
    }, 1000);
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    clearInterval(timerRef.current);
    timerRef.current = null;
    mediaRecorderRef.current.stop();
  };

  const sendRecording = async () => {
    if (!recordedBlob) return;

    try {
      setIsUploading(true);

      if (onSend) {
        await onSend(recordedBlob, recordedMode, recordingTime);
      }

      setRecordedBlob(null);
      setRecordingTime(0);
    } catch (err) {
      console.error('Send error:', err);
      setError('Ошибка отправки');
    } finally {
      setIsUploading(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      cancelAfterStopRef.current = true;
      mediaRecorderRef.current.stop();
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    chunksRef.current = [];
    setRecordedBlob(null);
    setRecordingTime(0);
    if (onCancel) onCancel();
  };

  const formatTime = (sec) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const hasRecording = !!recordedBlob;
  const isVideoRecording = isRecording && mode === 'video';

  if (!isRecording && !hasRecording) {
    return (
      <button
        className="simple-recorder-btn"
        onClick={startRecording}
        disabled={isUploading}
        title={mode === 'video' ? 'Запись видео' : 'Запись голоса'}
      >
        {mode === 'video' ? (
          <svg fill="currentColor" viewBox="0 0 24 24" width="24" height="24">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        ) : (
          <svg fill="currentColor" viewBox="0 0 24 24" width="24" height="24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        )}
      </button>
    );
  }

  if (isRecording) {
    return (
      <div className={`simple-recorder-controls${isVideoRecording ? ' is-video' : ''}`}>
        {mode === 'video' && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="simple-recorder-live-preview"
          />
        )}
        <div className="simple-recorder-timer">{formatTime(recordingTime)}</div>
        <button
          className="simple-recorder-stop"
          onClick={stopRecording}
          title="Остановить запись"
        >
          ⏹️
        </button>
        <button
          className="simple-recorder-cancel"
          onClick={cancelRecording}
          title="Отменить"
        >
          ✕
        </button>
      </div>
    );
  }

  // Showing recording preview
  return (
    <div className="simple-recorder-preview">
      <div className="simple-recorder-preview-info">
        {recordedMode === 'video' ? '🎥' : '🎤'} {formatTime(recordingTime)}
      </div>
      <button
        className="simple-recorder-send"
        onClick={sendRecording}
        disabled={isUploading}
      >
        {isUploading ? '...' : '📤 Отправить'}
      </button>
      <button
        className="simple-recorder-cancel"
        onClick={cancelRecording}
        disabled={isUploading}
      >
        ✕
      </button>
      {error && <div className="error-msg">{error}</div>}
    </div>
  );
}
