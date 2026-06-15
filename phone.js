const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const codeInput = document.getElementById('code-input');
const levelMeter = document.getElementById('level-meter');
const infoText = document.getElementById('info-text');
const pairingUi = document.getElementById('pairing-ui');
const meterUi = document.getElementById('meter-ui');

let peer = null;
let activeConn = null;
let activeCall = null;
let localStream = null;
let wakeLock = null;
let analyser = null;
let audioCtx = null;
let isStreaming = false;

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('[phone] Wake lock failed:', e);
  }
}

function setupLevelMeter(stream) {
  if (audioCtx) {
    audioCtx.close();
  }
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  function updateMeter() {
    if (!analyser || !isStreaming) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    const pct = Math.min(100, (avg / 128) * 100);
    levelMeter.style.width = pct + '%';
    requestAnimationFrame(updateMeter);
  }
  updateMeter();
}

async function startStreaming() {
  const code = codeInput.value.replace(/\s+/g, '');
  if (!code || code.length !== 6) {
    alert('Please enter a valid 6-digit code.');
    return;
  }

  try {
    setStatus('waiting', 'Requesting microphone access...');
    startBtn.disabled = true;

    // Get microphone with raw audio (no processing)
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    setStatus('waiting', 'Connecting to pairing server...');

    // Connect to PeerJS cloud server
    peer = new Peer();

    peer.on('open', (id) => {
      console.log('[phone] Connected to PeerJS cloud with ID:', id);
      setStatus('waiting', 'Sending pairing request to PC...');

      const pcId = 'webmic-pc-' + code;
      const conn = peer.connect(pcId);
      activeConn = conn;

      conn.on('open', () => {
        console.log('[phone] Data connection opened with PC');
        setStatus('waiting', 'Waiting for PC approval...');
        infoText.textContent = 'Please approve the connection on your PC screen.';
      });

      conn.on('data', (data) => {
        if (data.type === 'approved') {
          console.log('[phone] Connection approved by PC!');
          
          isStreaming = true;
          pairingUi.classList.add('hidden');
          meterUi.classList.remove('hidden');
          setStatus('streaming', 'Streaming to PC');
          startBtn.textContent = 'Stop Streaming';
          startBtn.disabled = false;
          infoText.textContent = 'Streaming! Keep this page open.';
          
          setupLevelMeter(localStream);
          requestWakeLock();

          // Call the PC to send the audio stream
          activeCall = peer.call(pcId, localStream);
          
          activeCall.on('close', () => {
            console.log('[phone] Call ended by PC');
            stopStreaming();
            setStatus('error', 'Disconnected by PC');
          });

        } else if (data.type === 'denied') {
          console.log('[phone] Connection denied by PC:', data.reason);
          stopStreaming();
          setStatus('error', 'Request Denied: ' + (data.reason || 'Declined'));
        }
      });

      conn.on('close', () => {
        console.log('[phone] Data connection closed');
        stopStreaming();
        setStatus('error', 'Connection closed');
      });
    });

    peer.on('error', (err) => {
      console.error('[phone] PeerJS error:', err);
      stopStreaming();
      let errorMsg = 'Server error';
      if (err.type === 'peer-not-found') {
        errorMsg = 'PC not found. Double check the code.';
      }
      setStatus('error', 'Error: ' + errorMsg);
    });

  } catch (e) {
    console.error('[phone] Start error:', e);
    const errorMsg = e ? (e.message || e.name || String(e)) : 'Unknown error';
    setStatus('error', 'Error: ' + errorMsg);
    stopStreaming();
  }
}

function stopStreaming() {
  isStreaming = false;

  if (activeCall) {
    activeCall.close();
    activeCall = null;
  }

  if (activeConn) {
    activeConn.close();
    activeConn = null;
  }

  if (peer) {
    peer.destroy();
    peer = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }

  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }

  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
    analyser = null;
  }

  levelMeter.style.width = '0%';
  startBtn.textContent = 'Connect & Stream';
  startBtn.disabled = false;
  pairingUi.classList.remove('hidden');
  meterUi.classList.add('hidden');
  infoText.textContent = 'Enter the 6-digit code shown on your PC to connect.';
  setStatus('waiting', 'Ready to connect');
}

startBtn.addEventListener('click', () => {
  if (isStreaming || peer) {
    stopStreaming();
  } else {
    startStreaming();
  }
});

// Auto-format pairing code input (limit to digits, max 6)
codeInput.addEventListener('input', (e) => {
  let val = e.target.value.replace(/\D/g, '');
  if (val.length > 6) val = val.slice(0, 6);
  e.target.value = val;
});

// Handle page visibility change for wake lock re-acquisition
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isStreaming && !wakeLock) {
    await requestWakeLock();
  }
});
