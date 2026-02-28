import { useEffect, useRef, useState, useCallback } from 'react';

const CROP_SIZE = 280; // display px

export default function AvatarCropModal({ file, onConfirm, onCancel }) {
  const [imgSrc, setImgSrc] = useState(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const pinchRef = useRef(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const minScale = useCallback((nw, nh) => {
    return CROP_SIZE / Math.min(nw, nh);
  }, []);

  const constrain = useCallback((ox, oy, sc, nw, nh) => {
    const dw = nw * sc;
    const dh = nh * sc;
    const maxOx = dw / 2 - CROP_SIZE / 2;
    const minOx = CROP_SIZE / 2 - dw / 2;
    const maxOy = dh / 2 - CROP_SIZE / 2;
    const minOy = CROP_SIZE / 2 - dh / 2;
    return {
      x: Math.max(minOx, Math.min(maxOx, ox)),
      y: Math.max(minOy, Math.min(maxOy, oy)),
    };
  }, []);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNaturalSize({ w, h });
    const sc = CROP_SIZE / Math.min(w, h);
    setScale(sc);
    setOffset({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = (e) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current || !naturalSize.w) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(constrain(dragRef.current.ox + dx, dragRef.current.oy + dy, scale, naturalSize.w, naturalSize.h));
  }, [scale, naturalSize, constrain]);

  const handleMouseUp = () => { dragRef.current = null; };

  const applyZoom = useCallback((newSc) => {
    if (!naturalSize.w) return;
    const mn = minScale(naturalSize.w, naturalSize.h);
    const clamped = Math.max(mn, Math.min(newSc, mn * 6));
    setScale(clamped);
    setOffset(o => constrain(o.x, o.y, clamped, naturalSize.w, naturalSize.h));
  }, [naturalSize, minScale, constrain]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    applyZoom(scale * (1 - e.deltaY * 0.003));
  }, [scale, applyZoom]);

  // Touch handlers — attached non-passively via useEffect
  const handleTouchStartRaw = useCallback((e) => {
    if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, ox: offset.x, oy: offset.y };
      pinchRef.current = null;
    } else if (e.touches.length === 2) {
      dragRef.current = null;
      pinchRef.current = {
        dist: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
        scale,
      };
    }
  }, [offset, scale]);

  const handleTouchMoveRaw = useCallback((e) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragRef.current && naturalSize.w) {
      const dx = e.touches[0].clientX - dragRef.current.startX;
      const dy = e.touches[0].clientY - dragRef.current.startY;
      setOffset(constrain(dragRef.current.ox + dx, dragRef.current.oy + dy, scale, naturalSize.w, naturalSize.h));
    } else if (e.touches.length === 2 && pinchRef.current && naturalSize.w) {
      const newDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      applyZoom(pinchRef.current.scale * (newDist / pinchRef.current.dist));
    }
  }, [scale, naturalSize, constrain, applyZoom]);

  const handleTouchEndRaw = useCallback(() => {
    dragRef.current = null;
    pinchRef.current = null;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStartRaw, { passive: true });
    el.addEventListener('touchmove', handleTouchMoveRaw, { passive: false });
    el.addEventListener('touchend', handleTouchEndRaw, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStartRaw);
      el.removeEventListener('touchmove', handleTouchMoveRaw);
      el.removeEventListener('touchend', handleTouchEndRaw);
    };
  }, [handleWheel, handleTouchStartRaw, handleTouchMoveRaw, handleTouchEndRaw]);

  const confirm = () => {
    const img = imgRef.current;
    if (!img || !naturalSize.w) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    // Calculate which part of the natural image maps to the crop square
    const imgDrawLeft = CROP_SIZE / 2 + offset.x - naturalSize.w * scale / 2;
    const imgDrawTop  = CROP_SIZE / 2 + offset.y - naturalSize.h * scale / 2;
    // In natural image coords: cropLeft = (0 - imgDrawLeft) / scale
    const srcX = (0 - imgDrawLeft) / scale;
    const srcY = (0 - imgDrawTop) / scale;
    const srcW = CROP_SIZE / scale;
    const srcH = CROP_SIZE / scale;
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, 512, 512);
    canvas.toBlob((blob) => { if (blob) onConfirm(blob); }, 'image/jpeg', 0.92);
  };

  if (!imgSrc) return null;

  const imgLeft = naturalSize.w ? CROP_SIZE / 2 + offset.x - naturalSize.w * scale / 2 : 0;
  const imgTop  = naturalSize.h ? CROP_SIZE / 2 + offset.y - naturalSize.h * scale / 2 : 0;

  return (
    <div className="crop-modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="crop-modal">
        <div className="crop-modal-header">
          <span>Обрезать фото</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="crop-hint">Перетащите и масштабируйте фото</div>

        {/* Wrapper to position dark vignette outside the circle */}
        <div className="crop-wrapper">
          <div
            className="crop-container"
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              ref={imgRef}
              src={imgSrc}
              alt=""
              onLoad={onImgLoad}
              style={{
                position: 'absolute',
                width: naturalSize.w ? naturalSize.w * scale : 'auto',
                height: naturalSize.h ? naturalSize.h * scale : 'auto',
                left: imgLeft,
                top: imgTop,
                userSelect: 'none',
                pointerEvents: 'none',
                draggable: false,
              }}
              draggable={false}
            />
          </div>
          {/* Circle guide vignette */}
          <div className="crop-vignette" />
        </div>

        <div className="crop-zoom-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          <input
            type="range"
            className="crop-zoom-slider"
            min={0}
            max={100}
            value={naturalSize.w
              ? Math.round(((scale - minScale(naturalSize.w, naturalSize.h)) / (minScale(naturalSize.w, naturalSize.h) * 5)) * 100)
              : 0}
            onChange={(e) => {
              if (!naturalSize.w) return;
              const mn = minScale(naturalSize.w, naturalSize.h);
              applyZoom(mn + (mn * 5) * (Number(e.target.value) / 100));
            }}
          />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        </div>

        <div className="crop-modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Отмена</button>
          <button className="btn btn-accent" onClick={confirm} disabled={!naturalSize.w}>Выбрать</button>
        </div>
      </div>
    </div>
  );
}
