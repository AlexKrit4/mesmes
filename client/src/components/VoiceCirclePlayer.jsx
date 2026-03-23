import React, { useRef, useState, useEffect } from 'react';

export default function VoiceCirclePlayer({ src, duration = 0 }) {
  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [videoDuration, setVideoDuration] = useState(duration || 0);

  const togglePlay = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const onSeek = (e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const next = Number(e.target.value);
    video.currentTime = next;
    setPosition(next);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : duration;
      setVideoDuration(dur);
    };
    const onTimeUpdate = () => {
      setPosition(video.currentTime || 0);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      setPosition(0);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);

    return () => {
      video.pause();
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
    };
  }, [src, duration]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const max = Math.max(videoDuration, 1);
  const value = Math.min(position, max);

  return (
    <div className="voice-circle-player" onClick={(e) => e.stopPropagation()}>
      <div className="voice-circle-preview">
        <video
          ref={videoRef}
          src={src}
          preload="metadata"
          style={{
            width: '100%',
            height: '200px',
            objectFit: 'cover',
            borderRadius: '8px',
            backgroundColor: '#000',
          }}
        />
        <button className="voice-circle-play" onClick={togglePlay}>
          {isPlaying ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>
      
      <div className="voice-circle-controls">
        <input
          type="range"
          className="voice-circle-progress"
          min="0"
          max={max}
          value={value}
          step="0.01"
          onChange={onSeek}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="voice-circle-time">
          {formatTime(position)} / {formatTime(videoDuration)}
        </div>
      </div>
    </div>
  );
}
