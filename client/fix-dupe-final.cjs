const fs = require('fs');
let code = fs.readFileSync('client/src/pages/Chat.jsx', 'utf8');

// Strip out ALL isRecording definitions temporarily
code = code.replace(/  const \[isRecording, setIsRecording\] = useState\(false\);\n/g, '');
code = code.replace(/  const \[mediaRecorder, setMediaRecorder\] = useState\(null\);\n/g, '');
code = code.replace(/  const \[audioChunks, setAudioChunks\] = useState\(\[\]\);\n/g, '');
code = code.replace(/  const audioChunksRef = React\.useRef\(\[\]\);\n/g, '');

// Put exactly one back
const stateToPut = `  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const audioChunksRef = React.useRef([]);
`;

code = code.replace('const [fileUploading, setFileUploading] = useState(false);', 
      'const [fileUploading, setFileUploading] = useState(false);\n' + stateToPut);

fs.writeFileSync('client/src/pages/Chat.jsx', code);
console.log('Fixed for sure!');
