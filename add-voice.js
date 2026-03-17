const fs = require('fs');
let code = fs.readFileSync('client/src/pages/Chat.jsx', 'utf8');

// we'll inject voice recording state and function right after file uploading states

const targetState = `  const [lightboxScale, setLightboxScale] = useState(1);
  const [fileUploading, setFileUploading] = useState(false);`;

const newState = targetState + `
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const audioChunksRef = React.useRef([]);
`;

code = code.replace(targetState, newState);

const targetMount = `  // Init chat
  useEffect(() => {`;

const newFunc = `  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const audioBlob = new File(audioChunksRef.current, 'voice.webm', { type: 'audio/webm' });
        addFiles([audioBlob]);
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (e) {
      alert('Ошибка доступа к микрофону. Проверьте разрешения.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setIsRecording(false);
      setMediaRecorder(null);
    }
  };

  ` + targetMount;

// Only replace once
if(code.indexOf('startRecording') === -1) {
    code = code.replace(targetMount, newFunc);
}

const oldSendBtn = `<button className="send-btn" onClick={sendMessage} title="Отправить" disabled={fileUploading}>`;

const newSendBtn = `
        {isRecording ? (
          <button className="send-btn" onClick={stopRecording} title="Остановить запись" style={{background: 'red', animation: 'pulse 1s infinite'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
          </button>
        ) : (
          <button className="send-btn" onClick={(e) => {
            if (!text.trim() && pendingFiles.length === 0) {
               e.preventDefault();
               startRecording();
            } else {
               sendMessage();
            }
          }} title={!text.trim() && pendingFiles.length === 0 ? "Голосовое сообщение" : "Отправить"} disabled={fileUploading}>
            {(!text.trim() && pendingFiles.length === 0) ? (
               <svg fill="currentColor" viewBox="0 0 24 24" width="24" height="24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            ) : (
               <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            )}
          </button>
        )}`;

code = code.replace(/<button className="send-btn" onClick=\{sendMessage\} title="Отправить" disabled=\{fileUploading\}>\s*<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2\.01 21L23 12 2\.01 3 2 10l15 2-15 2z"\/><\/svg>\s*<\/button>/g, newSendBtn);

fs.writeFileSync('client/src/pages/Chat.jsx', code);
console.log('done chat voice');
