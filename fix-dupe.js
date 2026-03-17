const fs = require('fs');
let code = fs.readFileSync('client/src/pages/Chat.jsx', 'utf8');

// Find all instances of isRecording state to see if they are duplicated
let parts = code.split('const [isRecording');
if (parts.length > 2) {
    // It is duplicated. Let's fix the file by removing the second set of state vars
    
    // Replace the duplicated block
    const dupBlock = `
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const audioChunksRef = React.useRef([]);
`;
    
    // Only keep the first occurrence of the state declarations
    code = code.replace(dupBlock, ''); 
    // And add it back just ONCE
    code = code.replace('const [fileUploading, setFileUploading] = useState(false);', 
      'const [fileUploading, setFileUploading] = useState(false);\n' + dupBlock);
      
    // deduplicate startRecording function
    let funcParts = code.split('const startRecording = async () => {');
    if (funcParts.length > 2) {
        // Find the block to remove
        const regex = /const startRecording = async \(\) => \{[\s\S]*?const stopRecording = \(\) => \{[\s\S]*?mediaRecorder = null;\s*\}\s*\};\s*/;
        // removing first match
        code = code.replace(regex, '');
    }
    
    fs.writeFileSync('client/src/pages/Chat.jsx', code);
    console.log('Fixed duplications!');
} else {
    console.log('No duplications found, might be a different issue.');
}
