import React, { useRef, useState } from 'react';

function formatTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function CircleVideoMessage({ src, onLoadedMetadata }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);

  const togglePlayback = async (event) => {
    event?.stopPropagation?.();
    if (!videoRef.current) return;

    try {
      if (videoRef.current.paused) {
        await videoRef.current.play();
        setPlaying(true);
      } else {
        videoRef.current.pause();
        setPlaying(false);
      }
    } catch {
      setPlaying(false);
    }
  };

  const handleSeek = (event) => {
    event.stopPropagation();
    const value = Number(event.target.value || 0);
    setPosition(value);
    if (videoRef.current) videoRef.current.currentTime = value;
  };

  return (
    <div className="msg-circle-video" onClick={togglePlayback}>
      <div className="msg-circle-video-wrap">
        <video
          ref={videoRef}
          src={src}
          playsInline
          className="msg-circle-video-el"
          onLoadedMetadata={(event) => {
            const d = Number(event.currentTarget.duration || 0);
            setDuration(Number.isFinite(d) ? d : 0);
            if (onLoadedMetadata) onLoadedMetadata(event);
          }}
          onTimeUpdate={(event) => setPosition(Number(event.currentTarget.currentTime || 0))}
          onEnded={() => setPlaying(false)}
        />
      </div>
      <div className="msg-circle-player-strip" onClick={(event) => event.stopPropagation()}>
        <button className="msg-circle-play" onClick={togglePlayback} type="button">
          {playing ? '⏸' : '▶'}
        </button>
        <input
          className="msg-circle-seek"
          type="range"
          min="0"
          max={duration || 0}
          value={Math.min(position, duration || 0)}
          step="0.01"
          onChange={handleSeek}
        />
        <span className="msg-circle-time">{formatTime(position)} / {formatTime(duration)}</span>
      </div>
    </div>
  );
}
