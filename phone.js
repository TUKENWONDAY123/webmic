const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const startBtn = document.getElementById('start-btn');
const codeInput = document.getElementById('code-input');
const infoText = document.getElementById('info-text');
const pairingUi = document.getElementById('pairing-ui');
const streamingUi = document.getElementById('streaming-ui');
const micBtn = document.getElementById('mic-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const micGlow = document.getElementById('mic-glow');
const micSvgActive = document.getElementById('mic-svg-active');
const micSvgMuted = document.getElementById('mic-svg-muted');

let peer = null;
let activeConn = null;
let activeCall = null;
let localStream = null;
let wakeLock = null;
let analyser = null;
let audioCtx = null;
let isStreaming = false;
let isMuted = false;

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
    if (!analyser || !isStreaming) {
      micGlow.style.transform = 'scale(1)';
      return;
    }
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;

    // Map avg (0-128) to scale (1.0 to 1.4) and glow shadows
    const scale = 1.0 + (avg / 128) * 0.4;
    micGlow.style.transform = `scale(${scale})`;

    const shadowBlur = 20 + (avg / 128) * 30;
    const shadowOpacity = 0.15 + (avg / 128) * 0.35;
    const color = isMuted ? '239, 68, 68' : '16, 185, 129';
    micGlow.style.boxShadow = `0 0 ${shadowBlur}px rgba(${color}, ${shadowOpacity})`;

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
    setStatus('waiting', 'Requesting mic access...');
    startBtn.disabled = true;

    // Get microphone with raw audio (no processing)
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    setStatus('waiting', 'Connecting...');

    peer = new Peer();

    peer.on('open', (id) => {
      console.log('[phone] Connected with ID:', id);
      setStatus('waiting', 'Pairing with PC...');

      const pcId = 'webmic-pc-' + code;
      const conn = peer.connect(pcId);
      activeConn = conn;

      conn.on('open', () => {
        setStatus('waiting', 'Waiting for approval...');
        infoText.textContent = 'Approve connection on your PC screen.';
      });

      conn.on('data', (data) => {
        if (data.type === 'approved') {
          console.log('[phone] Pairing approved by PC');
          
          isStreaming = true;
          isMuted = false;
          micBtn.classList.remove('muted');
          micSvgActive.classList.remove('hidden');
          micSvgMuted.classList.add('hidden');

          pairingUi.classList.add('hidden');
          streamingUi.classList.remove('hidden');
          
          setStatus('streaming', 'Streaming Live');
          infoText.textContent = 'Streaming live to PC. Tap mic to mute.';
          
          setupLevelMeter(localStream);
          requestWakeLock();

          // Call the PC to send the audio stream
          activeCall = peer.call(pcId, localStream);
          
          activeCall.on('close', () => {
            console.log('[phone] Stream closed by PC');
            stopStreaming();
            setStatus('error', 'Disconnected by PC');
          });

        } else if (data.type === 'denied') {
          console.log('[phone] Pairing denied:', data.reason);
          stopStreaming();
          setStatus('error', data.reason || 'Pairing denied');
        }
      });

      conn.on('close', () => {
        console.log('[phone] Control channel closed');
        stopStreaming();
        setStatus('error', 'Connection lost');
      });
    });

    peer.on('error', (err) => {
      console.error('[phone] PeerJS error:', err);
      stopStreaming();
      let errorMsg = 'Server connection failed';
      if (err.type === 'peer-not-found') {
        errorMsg = 'PC not found. Verify code.';
      }
      setStatus('error', errorMsg);
    });

  } catch (e) {
    console.error('[phone] Start error:', e);
    const errorMsg = e ? (e.message || e.name || String(e)) : 'Unknown error';
    setStatus('error', errorMsg);
    stopStreaming();
  }
}

function stopStreaming() {
  isStreaming = false;
  isMuted = false;

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

  micGlow.style.transform = 'scale(1)';
  micGlow.style.boxShadow = 'none';

  startBtn.disabled = false;
  pairingUi.classList.remove('hidden');
  streamingUi.classList.add('hidden');
  infoText.textContent = 'Enter the 6-digit code shown on your PC to connect.';
  setStatus('waiting', 'Ready to connect');
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = !isMuted;
  });

  micBtn.classList.toggle('muted', isMuted);
  micSvgActive.classList.toggle('hidden', isMuted);
  micSvgMuted.classList.toggle('hidden', !isMuted);

  if (isMuted) {
    infoText.textContent = 'Microphone muted. Tap again to unmute.';
    setStatus('waiting', 'Microphone Muted');
  } else {
    infoText.textContent = 'Streaming live to PC. Tap mic to mute.';
    setStatus('streaming', 'Streaming Live');
  }
}

startBtn.addEventListener('click', () => {
  if (isStreaming || peer) {
    stopStreaming();
  } else {
    startStreaming();
  }
});

disconnectBtn.addEventListener('click', stopStreaming);
micBtn.addEventListener('click', toggleMute);

// Format input (limit to numbers, max length 6)
codeInput.addEventListener('input', (e) => {
  let val = e.target.value.replace(/\D/g, '');
  if (val.length > 6) val = val.slice(0, 6);
  e.target.value = val;
});

// Manage visibility states for wake locks
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && isStreaming && !wakeLock) {
    await requestWakeLock();
  }
});
