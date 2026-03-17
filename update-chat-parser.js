const fs = require('fs');
let code = fs.readFileSync('client/src/pages/Chat.jsx', 'utf8');

const oldParse = `function parseFileUrls(file_url) {
  if (!file_url) return [];
  if (file_url.startsWith('[')) {
    try { return JSON.parse(file_url); } catch { return [file_url]; }
  }
  return [file_url];
}`;

const newParse = `function parseFileUrls(file_url) {
  if (!file_url) return [];
  let parsed = [];
  if (file_url.startsWith('[')) {
    try { parsed = JSON.parse(file_url); } catch { return [{url: file_url}]; }
  } else {
    parsed = [file_url];
  }
  return parsed.map(p => typeof p === 'string' ? { url: p, type: p.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' } : p);
}`;

code = code.replace(oldParse, newParse);

const oldIsVideo = `function isVideo(url) {
  if (!url) return false;
  return url.match(/\\.(mp4|webm|mov|mkv)$/i) || false;
}`;

const newIsVideo = `function isVideo(fileObj) {
  if (!fileObj) return false;
  if (fileObj.type && fileObj.type.startsWith('video/')) return true;
  return fileObj.url && fileObj.url.match(/\\.(mp4|webm|mov|mkv)$/i);
}

function isAudio(fileObj) {
  if (!fileObj) return false;
  return fileObj.type && fileObj.type.startsWith('audio/') || (fileObj.url && fileObj.url.match(/\\.(mp3|wav|ogg|m4a)$/i));
}

function isImage(fileObj) {
  if (!fileObj) return false;
  return (!isVideo(fileObj) && !isAudio(fileObj)) && (fileObj.type ? fileObj.type.startsWith('image/') : fileObj.url.match(/\\.(jpg|jpeg|png|gif|webp)$/i));
}`;

code = code.replace(oldIsVideo, newIsVideo);

// Now in render logic... I'll just write a script to replace the rendering block.

// Replace the UI in Chat
const oldRender = `{urls.length === 1 && isVideo(urls[0]) && (
                  <video
                    src={urls[0]}
                    className="msg-video"
                    controls
                    playsInline
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {urls.length === 1 && !isVideo(urls[0]) && (
                  <img
                    src={urls[0]}
                    className="msg-image"
                    alt=""
                    onClick={(e) => { e.stopPropagation(); openLightbox(urls, 0); }}
                  />
                )}
                {urls.length > 1 && (
                  <div className={\`msg-collage c\${urls.length}\`}>
                    {urls.map((url, i) => (
                      isVideo(url) ? (
                        <video
                          key={i}
                          src={url}
                          className="msg-collage-img"
                          controls
                          playsInline
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <img
                          key={i}
                          src={url}
                          className="msg-collage-img"
                          alt=""
                          onClick={(e) => { e.stopPropagation(); openLightbox(urls.filter(u => !isVideo(u)), urls.filter(u => !isVideo(u)).indexOf(url)); }}
                        />
                      )
                    ))}
                  </div>
                )}`;

const newRender = `{urls.map((fileObj, i) => {
                  if (isVideo(fileObj)) {
                    return <video key={i} src={fileObj.url} className="msg-video" controls playsInline onClick={e => e.stopPropagation()} style={{maxWidth: '100%', borderRadius: '8px'}} />;
                  } else if (isAudio(fileObj)) {
                    return <audio key={i} src={fileObj.url} controls onClick={e => e.stopPropagation()} style={{maxWidth: '100%'}} />;
                  } else if (isImage(fileObj)) {
                    return <img key={i} src={fileObj.url} className="msg-image" alt="" onClick={(e) => {
                      e.stopPropagation();
                      const imgUrls = urls.filter(isImage).map(u => u.url);
                      openLightbox(imgUrls, imgUrls.indexOf(fileObj.url));
                    }} style={{maxWidth: '100%', borderRadius: '8px', cursor: 'pointer', display: 'block', marginBottom: urls.length > 1 ? '5px' : 0}} />;
                  } else {
                    return <a key={i} href={fileObj.url} download target="_blank" rel="noopener noreferrer" className="msg-file-link" onClick={e => e.stopPropagation()} style={{display: 'flex', alignItems: 'center', padding: '10px', background: 'rgba(0,0,0,0.1)', borderRadius: '8px', textDecoration: 'none', color: 'inherit', marginBottom: '5px'}}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{marginRight: '10px'}}><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                      <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{fileObj.name || (fileObj.url ? fileObj.url.split('/').pop() : 'Файл')}</span>
                    </a>;
                  }
                })}`;

code = code.replace(oldRender, newRender);

const oldLightboxImgUrl = `openLightbox(urls.filter(u => !isVideo(u)), urls.filter(u => !isVideo(u)).indexOf(url));`;
code = code.replace(/openLightbox\(urls, 0\)/g, "const imgUrls = urls.filter(isImage).map(u => u.url); openLightbox(imgUrls, 0)");

fs.writeFileSync('client/src/pages/Chat.jsx', code);
console.log('done chat render UI');
