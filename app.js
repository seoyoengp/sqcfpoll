// App State Management
let state = {
  candidates: ['후보자 1', '후보자 2', '후보자 3', '후보자 4'],
  stickers: [], // [{ id, quadrant, x, y, type, rotation }]
  settings: {
    showCounts: true,
    soundEnabled: true,
    activeStickerStyle: 'dot'
  }
};

let binId = null; // cloud storage bin id
let pendingImport = null;
let qrCodeGenerator = null;
let myVotesCast = parseInt(localStorage.getItem('my_votes_cast') || '0');
let passcodeAttempt = '';

// DOM Selectors
const doc = document;
const quadrants = doc.querySelectorAll('.quadrant');
const totalVotesEl = doc.getElementById('totalVotes');
const settingsModal = doc.getElementById('settingsModal');
const openSettingsBtn = doc.getElementById('openSettingsBtn');
const closeSettingsBtn = doc.getElementById('closeSettingsBtn');
const saveSettingsBtn = doc.getElementById('saveSettingsBtn');
const resetVotesBtn = doc.getElementById('resetVotesBtn');
const exportBackupBtn = doc.getElementById('exportBackupBtn');
const importFileInput = doc.getElementById('importFileInput');
const toggleShowCounts = doc.getElementById('toggleShowCounts');
const toggleSound = doc.getElementById('toggleSound');
const stickerStyleCards = doc.querySelectorAll('.sticker-style-card');
const toastEl = doc.getElementById('toast');
const toastMessageEl = doc.getElementById('toastMessage');

// Admin Passcode elements
const adminCodeOverlay = doc.getElementById('adminCodeOverlay');
const passcodeInput = doc.getElementById('passcodeInput');
const cancelPasscodeBtn = doc.getElementById('cancelPasscodeBtn');
const keypadBtns = doc.querySelectorAll('#keypadContainer .keypad-btn');
const keypadClear = doc.getElementById('keypadClear');
const keypadBackspace = doc.getElementById('keypadBackspace');

// Voting Limit elements
const voteLimitOverlay = doc.getElementById('voteLimitOverlay');
const closeLimitOverlayBtn = doc.getElementById('closeLimitOverlayBtn');
const resetLimitBtn = doc.getElementById('resetLimitBtn');

// Cloud Sync elements
const cloudSaveBtn = doc.getElementById('cloudSaveBtn');
const cloudStatus = doc.getElementById('cloudStatus');
const cloudStatusText = doc.getElementById('cloudStatusText');

// Import Dialog
const importDialogOverlay = doc.getElementById('importDialogOverlay');
const importDialogText = doc.getElementById('importDialogText');
const dialogOverwriteBtn = doc.getElementById('dialogOverwriteBtn');
const dialogMergeBtn = doc.getElementById('dialogMergeBtn');
const dialogCancelBtn = doc.getElementById('dialogCancelBtn');

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  loadStateFromStorage();
  bindEvents();
  renderInitialState();
  checkUrlParamsForCloudLoad();
  checkUrlHashForImport();
  setupServiceWorker();
});

// Load state
function loadStateFromStorage() {
  const savedState = localStorage.getItem('sticker_vote_state');
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState);
      if (parsed.candidates) state.candidates = parsed.candidates;
      if (parsed.stickers) state.stickers = parsed.stickers;
      if (parsed.settings) state.settings = { ...state.settings, ...parsed.settings };
    } catch (e) {
      console.error('Failed to parse saved state:', e);
    }
  }
}

// Save state
function saveStateToStorage() {
  localStorage.setItem('sticker_vote_state', JSON.stringify(state));
}

// Bind Interactions
function bindEvents() {
  // Voting Quadrants Click/Tap
  quadrants.forEach(quad => {
    quad.addEventListener('click', (e) => {
      // Check vote limit first
      if (myVotesCast >= 2) {
        openVoteLimitOverlay();
        playErrorSound();
        return;
      }

      const rect = quad.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const quadIndex = parseInt(quad.getAttribute('data-index'));
      
      const paddedX = Math.max(3, Math.min(97, x));
      const paddedY = Math.max(3, Math.min(97, y));
      
      addStickerVote(quadIndex, paddedX, paddedY);
      createRippleEffect(quad, e.clientX - rect.left, e.clientY - rect.top);
    });
  });

  // Settings Gear Button: Open passcode verification instead of opening settings directly
  openSettingsBtn.addEventListener('click', showAdminPasscodePrompt);
  
  // Custom Long Press option on Settings Gear (Kiosk mode safety)
  let gearPressTimer;
  openSettingsBtn.addEventListener('touchstart', (e) => {
    gearPressTimer = setTimeout(() => {
      showAdminPasscodePrompt();
    }, 1500); // 1.5s hold to open via touch
  });
  openSettingsBtn.addEventListener('touchend', () => {
    clearTimeout(gearPressTimer);
  });

  // Numeric Passcode Input keypad event triggers
  keypadBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const digit = btn.getAttribute('data-val');
      if (passcodeAttempt.length < 4) {
        passcodeAttempt += digit;
        passcodeInput.value = passcodeAttempt;
        
        if (passcodeAttempt.length === 4) {
          // Verify code
          if (passcodeAttempt === '0503') {
            adminCodeOverlay.classList.remove('active');
            passcodeAttempt = '';
            passcodeInput.value = '';
            openSettings();
          } else {
            // Shake dialog box to indicate error
            const box = adminCodeOverlay.querySelector('.dialog-box');
            box.classList.add('shake');
            playErrorSound();
            
            setTimeout(() => {
              box.classList.remove('shake');
              passcodeAttempt = '';
              passcodeInput.value = '';
            }, 400);
          }
        }
      }
    });
  });

  keypadClear.addEventListener('click', () => {
    passcodeAttempt = '';
    passcodeInput.value = '';
  });

  keypadBackspace.addEventListener('click', () => {
    passcodeAttempt = passcodeAttempt.slice(0, -1);
    passcodeInput.value = passcodeAttempt;
  });

  cancelPasscodeBtn.addEventListener('click', () => {
    adminCodeOverlay.classList.remove('active');
    passcodeAttempt = '';
    passcodeInput.value = '';
  });

  // Vote limit overlay close
  closeLimitOverlayBtn.addEventListener('click', () => {
    voteLimitOverlay.classList.remove('active');
  });

  // Reset visitor vote limit in settings
  resetLimitBtn.addEventListener('click', () => {
    myVotesCast = 0;
    localStorage.setItem('my_votes_cast', '0');
    closeSettings();
    showToast("개인 투표 제한이 초기화되었습니다 (새 투표 준비 완료).");
  });

  // Cloud Save button trigger
  cloudSaveBtn.addEventListener('click', saveStateToCloud);

  // Settings Panel buttons
  closeSettingsBtn.addEventListener('click', closeSettings);
  saveSettingsBtn.addEventListener('click', saveAndApplySettings);

  // Sticker Design Selection
  stickerStyleCards.forEach(card => {
    card.addEventListener('click', () => {
      stickerStyleCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      state.settings.activeStickerStyle = card.getAttribute('data-style');
    });
  });

  // Reset and Data Management
  resetVotesBtn.addEventListener('click', () => {
    if (confirm("정말로 모든 투표를 초기화하시겠습니까? 붙여진 모든 스티커와 숫자가 삭제되며 복구할 수 없습니다.")) {
      state.stickers = [];
      saveStateToStorage();
      renderAllStickers();
      updateVoteCounts();
      updateSyncQR();
      closeSettings();
      showToast("모든 투표가 성공적으로 초기화되었습니다!");
      
      // Auto save to cloud if synced
      if (binId) {
        saveStateToCloud();
      }
    }
  });

  exportBackupBtn.addEventListener('click', exportStateAsJSON);
  importFileInput.addEventListener('change', handleJSONImport);

  // Dialog Actions
  dialogOverwriteBtn.addEventListener('click', () => applyPendingImport(true));
  dialogMergeBtn.addEventListener('click', () => applyPendingImport(false));
  dialogCancelBtn.addEventListener('click', () => {
    importDialogOverlay.classList.remove('active');
    pendingImport = null;
    window.location.hash = '';
  });
}

// Show Passcode Verification Dialog
function showAdminPasscodePrompt() {
  passcodeAttempt = '';
  passcodeInput.value = '';
  adminCodeOverlay.classList.add('active');
}

// Show Vote Limit Dialog
function openVoteLimitOverlay() {
  voteLimitOverlay.classList.add('active');
}

// Sound Synthesis using Web Audio API
function playPopSound() {
  if (!state.settings.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sine';
    
    osc.frequency.setValueAtTime(400, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.08);
    
    gainNode.gain.setValueAtTime(0.01, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    console.error("Audio block:", e);
  }
}

// Buzz error sound for wrong passcode or blocked voting
function playErrorSound() {
  if (!state.settings.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, audioCtx.currentTime);
    osc.frequency.setValueAtTime(90, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.26);
  } catch (e) {}
}

// Add Sticker Vote
function addStickerVote(quadIndex, x, y) {
  const rotation = Math.floor(Math.random() * 30) - 15;
  const id = 'st_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  const type = state.settings.activeStickerStyle;

  const newSticker = { id, quadrant: quadIndex, x, y, type, rotation };
  state.stickers.push(newSticker);
  
  // Track personal vote count
  myVotesCast++;
  localStorage.setItem('my_votes_cast', myVotesCast.toString());
  
  saveStateToStorage();
  createStickerDOM(newSticker);
  updateVoteCounts();
  playPopSound();

  // If voter cast exactly 2 votes, show overlay
  if (myVotesCast >= 2) {
    setTimeout(() => {
      openVoteLimitOverlay();
    }, 600);
  }
}

// Create Sticker in DOM
function createStickerDOM(sticker) {
  const quadElement = doc.getElementById(`q${sticker.quadrant + 1}`);
  if (!quadElement) return;

  const stickerEl = doc.createElement('div');
  stickerEl.className = 'sticker';
  
  stickerEl.style.left = `${sticker.x}%`;
  stickerEl.style.top = `${sticker.y}%`;
  stickerEl.style.setProperty('--rand-rot', `${sticker.rotation}deg`);

  if (sticker.type === 'dot') {
    stickerEl.classList.add(`sticker-color-q${sticker.quadrant + 1}`);
  } else if (sticker.type === 'badge') {
    const badgeColors = ['gold', 'silver', 'bronze', 'silver'];
    const badgeColor = badgeColors[sticker.quadrant] || 'gold';
    stickerEl.classList.add(`sticker-badge-${badgeColor}`);
    stickerEl.textContent = '🏆';
  } else if (sticker.type === 'star') {
    stickerEl.classList.add('sticker-emoji');
    stickerEl.textContent = '⭐';
  } else if (sticker.type === 'heart') {
    stickerEl.classList.add('sticker-emoji');
    stickerEl.textContent = '❤️';
  }

  quadElement.appendChild(stickerEl);
}

// Ripple touch feedback
function createRippleEffect(element, x, y) {
  const ripple = doc.createElement('div');
  ripple.className = 'tap-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  element.appendChild(ripple);
  
  setTimeout(() => {
    ripple.remove();
  }, 600);
}

// Render initial load
function renderInitialState() {
  updateDOMCandidateNames();
  renderAllStickers();
  updateVoteCounts();
}

// Reset DOM stickers and draw everything
function renderAllStickers() {
  quadrants.forEach(quad => {
    const stickers = quad.querySelectorAll('.sticker');
    stickers.forEach(s => s.remove());
  });

  state.stickers.forEach(sticker => {
    createStickerDOM(sticker);
  });
}

// Calculate and refresh vote counts
function updateVoteCounts() {
  const counts = [0, 0, 0, 0];
  state.stickers.forEach(s => {
    if (s.quadrant >= 0 && s.quadrant < 4) {
      counts[s.quadrant]++;
    }
  });

  let total = 0;
  counts.forEach((count, idx) => {
    const countEl = doc.getElementById(`countQ${idx + 1}`);
    if (countEl) {
      countEl.textContent = count;
      if (state.settings.showCounts) {
        countEl.classList.remove('hidden');
      } else {
        countEl.classList.add('hidden');
      }
    }
    total += count;
  });

  totalVotesEl.textContent = total;
}

// Set Candidate names in DOM
function updateDOMCandidateNames() {
  state.candidates.forEach((name, idx) => {
    const nameEl = doc.getElementById(`nameQ${idx + 1}`);
    if (nameEl) nameEl.textContent = name;
  });
}

// Manage Settings Panel Open/Close
function openSettings() {
  state.candidates.forEach((name, idx) => {
    doc.getElementById(`inputQ${idx + 1}`).value = name;
  });

  toggleShowCounts.checked = state.settings.showCounts;
  toggleSound.checked = state.settings.soundEnabled;

  stickerStyleCards.forEach(card => {
    if (card.getAttribute('data-style') === state.settings.activeStickerStyle) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });

  updateSyncQR();
  settingsModal.classList.add('active');
}

function closeSettings() {
  settingsModal.classList.remove('active');
}

// Save and apply configurations
function saveAndApplySettings() {
  state.candidates = [
    doc.getElementById('inputQ1').value.trim() || '후보자 1',
    doc.getElementById('inputQ2').value.trim() || '후보자 2',
    doc.getElementById('inputQ3').value.trim() || '후보자 3',
    doc.getElementById('inputQ4').value.trim() || '후보자 4'
  ];

  state.settings.showCounts = toggleShowCounts.checked;
  state.settings.soundEnabled = toggleSound.checked;

  saveStateToStorage();
  updateDOMCandidateNames();
  updateVoteCounts();
  closeSettings();
  showToast("설정이 성공적으로 저장되었습니다!");

  // If connected to cloud, auto push changes
  if (binId) {
    saveStateToCloud();
  }
}

// Toast Notification
function showToast(message) {
  toastMessageEl.textContent = message;
  toastEl.classList.add('show');
  
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}

// Base64 Helpers
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return decodeURIComponent(escape(atob(base64)));
}

// State Serialization for QR code URL sync
function serializeState() {
  const candidatesStr = state.candidates.map(encodeURIComponent).join(',');
  const styleTypes = ['dot', 'star', 'heart', 'badge'];
  const stickersStr = state.stickers.map(s => {
    const styleIdx = styleTypes.indexOf(s.type);
    const compactX = Math.round(s.x * 10);
    const compactY = Math.round(s.y * 10);
    return `${s.quadrant}.${compactX}.${compactY}.${styleIdx >= 0 ? styleIdx : 0}`;
  }).join(';');

  return `${candidatesStr}|${stickersStr}`;
}

// Update settings Sync QR Code Canvas
function updateSyncQR() {
  try {
    let syncUrl = '';
    if (binId) {
      // If we have a cloud storage URL
      syncUrl = window.location.origin + window.location.pathname + '?id=' + binId;
    } else {
      // Offline fallback string
      const serialized = serializeState();
      const base64Str = toBase64(serialized);
      syncUrl = `${window.location.origin}${window.location.pathname}#sync=${base64Str}`;
    }
    
    const qrCanvas = doc.getElementById('syncQrCanvas');
    if (!qrCanvas) return;

    if (!qrCodeGenerator) {
      qrCodeGenerator = new QRious({
        element: qrCanvas,
        value: syncUrl,
        size: 180,
        level: 'L'
      });
    } else {
      qrCodeGenerator.value = syncUrl;
    }
  } catch (e) {
    console.error("QR error:", e);
  }
}

// Cloud persistence API: extendsclass.com implementation
async function saveStateToCloud() {
  setCloudStatusVisual('syncing', '클라우드 저장 중...');
  try {
    let url = 'https://extendsclass.com/api/json-storage/bin';
    let method = 'POST';
    
    // If a document ID is already present, write to it
    if (binId) {
      url = `https://extendsclass.com/api/json-storage/bin/${binId}`;
      method = 'PUT';
    }

    const response = await fetch(url, {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(state)
    });

    if (!response.ok) throw new Error("Server error " + response.status);
    const result = await response.json();

    // If new document was created, save its ID and update browser URL
    if (!binId && result.id) {
      binId = result.id;
      const newUrl = `${window.location.origin}${window.location.pathname}?id=${binId}`;
      window.history.replaceState({ path: newUrl }, '', newUrl);
    }

    saveStateToStorage();
    updateSyncQR();
    setCloudStatusVisual('online', '클라우드 연동됨');
    showToast("클라우드 서버에 성공적으로 투표 상태를 저장했습니다!");
  } catch (e) {
    console.error("Cloud save failed:", e);
    setCloudStatusVisual('offline', '로컬 모드 (저장 오류)');
    showToast("클라우드 저장에 실패했습니다. 오프라인으로 전환합니다.");
  }
}

// Fetch from cloud on load
async function fetchStateFromCloud(id) {
  setCloudStatusVisual('syncing', '클라우드 연동 중...');
  try {
    const response = await fetch(`https://extendsclass.com/api/json-storage/bin/${id}`);
    if (!response.ok) throw new Error("Document not found");
    const fetchedData = await response.json();

    if (fetchedData.candidates && fetchedData.stickers) {
      state.candidates = fetchedData.candidates;
      state.stickers = fetchedData.stickers;
      if (fetchedData.settings) {
        state.settings = { ...state.settings, ...fetchedData.settings };
      }

      saveStateToStorage();
      renderInitialState();
      setCloudStatusVisual('online', '클라우드 연동됨');
      showToast("클라우드에서 투표 내역을 성공적으로 동기화했습니다!");
    } else {
      throw new Error("Invalid schema");
    }
  } catch (e) {
    console.error("Cloud load error:", e);
    setCloudStatusVisual('offline', '로컬 복구됨');
    showToast("클라우드 연결 오류. 태블릿 기기의 백업 상태로 작동합니다.");
  }
}

// Update status indicator visually
function setCloudStatusVisual(statusClass, label) {
  cloudStatus.className = `cloud-status-badge status-${statusClass}`;
  cloudStatusText.textContent = label;
}

// Check parameters on load
function checkUrlParamsForCloudLoad() {
  const urlParams = new URLSearchParams(window.location.search);
  const idParam = urlParams.get('id');
  if (idParam) {
    binId = idParam;
    fetchStateFromCloud(binId);
  } else {
    setCloudStatusVisual('offline', '로컬 저장됨');
  }
}

// JSON Backup download
function exportStateAsJSON() {
  try {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchor = doc.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("download", `sticker_vote_backup_${dateStr}.json`);
    
    doc.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("백업 파일 다운로드가 시작되었습니다.");
  } catch (e) {
    showToast("백업 내보내기에 실패했습니다.");
  }
}

// JSON Restore handler
function handleJSONImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const parsed = JSON.parse(event.target.result);
      if (parsed.candidates && parsed.stickers) {
        pendingImport = {
          candidates: parsed.candidates,
          stickers: parsed.stickers,
          settings: parsed.settings || state.settings
        };
        openImportDialog(`불러온 백업 파일 (${parsed.stickers.length}개의 투표 내역)`);
      } else {
        showToast("오류: 유효한 스티커 백업 JSON 형식이 아닙니다.");
      }
    } catch (err) {
      showToast("오류: 파일을 파싱하는 데 실패했습니다.");
    }
    importFileInput.value = '';
  };
  reader.readAsText(file);
}

// URL sync detection on load (Offline fallback hashes)
function checkUrlHashForImport() {
  const hash = window.location.hash;
  if (!hash.startsWith('#sync=')) return;
  
  const base64Str = hash.replace('#sync=', '');
  if (!base64Str) return;

  try {
    let base64 = base64Str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = decodeURIComponent(escape(atob(base64)));
    const parts = decoded.split('|');
    if (parts.length >= 2) {
      const candidateNames = parts[0].split(',').map(decodeURIComponent);
      const stickersStr = parts[1];
      const importedStickers = [];

      if (stickersStr) {
        const styleTypes = ['dot', 'star', 'heart', 'badge'];
        const tokens = stickersStr.split(';');
        
        tokens.forEach((tok, index) => {
          if (!tok) return;
          const pieces = tok.split('.');
          if (pieces.length === 4) {
            const quad = parseInt(pieces[0]);
            const x = parseInt(pieces[1]) / 10;
            const y = parseInt(pieces[2]) / 10;
            const styleIdx = parseInt(pieces[3]);
            const type = styleTypes[styleIdx] || 'dot';
            const rotation = Math.floor(Math.random() * 30) - 15;

            importedStickers.push({
              id: `st_qr_${index}_${Math.random().toString(36).substr(2, 5)}`,
              quadrant: quad,
              x,
              y,
              type,
              rotation
            });
          }
        });
      }

      pendingImport = {
        candidates: candidateNames,
        stickers: importedStickers
      };

      openImportDialog(`QR 코드 스캔 정보 (${importedStickers.length}개의 투표 내역)`);
    }
  } catch (e) {
    console.error("URL sync error:", e);
    showToast("동기화 QR 데이터를 읽는 데 실패했습니다.");
  }
}

// Dialog management
function openImportDialog(descriptionText) {
  importDialogText.innerHTML = `
    <strong>${descriptionText}</strong>을 발견했습니다.<br>
    가져올 데이터를 기존 투표 현황에 어떻게 반영할까요?<br><br>
    <span style="color:#f59e0b; font-size:0.8rem;">⚠️ '기존 투표 모두 덮어쓰기'를 선택할 경우, 이 기기의 현재 투표 상태는 지워집니다.</span>
  `;
  importDialogOverlay.classList.add('active');
}

function applyPendingImport(shouldOverwrite) {
  if (!pendingImport) return;

  if (shouldOverwrite) {
    state.candidates = [...pendingImport.candidates];
    state.stickers = [...pendingImport.stickers];
    if (pendingImport.settings) state.settings = { ...pendingImport.settings };
  } else {
    state.stickers = [...state.stickers, ...pendingImport.stickers];
    const isDefault = state.candidates.every((c, i) => c === `후보자 ${i + 1}`);
    if (isDefault) {
      state.candidates = [...pendingImport.candidates];
    }
  }

  saveStateToStorage();
  updateDOMCandidateNames();
  renderAllStickers();
  updateVoteCounts();
  updateSyncQR();

  importDialogOverlay.classList.remove('active');
  pendingImport = null;
  
  history.replaceState(null, document.title, window.location.pathname + (binId ? `?id=${binId}` : ''));
  
  showToast(shouldOverwrite ? "데이터를 덮어써서 복구했습니다!" : "기존 투표 현황과 데이터를 병합했습니다!");

  if (binId) {
    saveStateToCloud();
  }
}

// Service worker setup for offline usability (PWA)
function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('SW scope:', reg.scope))
        .catch(err => console.warn('SW failed:', err));
    });

    let deferredPrompt;
    const pwaBanner = doc.getElementById('pwaBanner');
    const pwaInstallBtn = doc.getElementById('pwaInstallBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      pwaBanner.classList.add('show');
    });

    pwaInstallBtn.addEventListener('click', () => {
      if (!deferredPrompt) return;
      pwaBanner.classList.remove('show');
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => {
        deferredPrompt = null;
      });
    });

    window.addEventListener('appinstalled', () => {
      pwaBanner.classList.remove('show');
      showToast("스티커 투표 보드가 성공적으로 앱으로 설치되었습니다!");
    });
  }
}
