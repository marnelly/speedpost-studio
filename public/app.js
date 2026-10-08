// SpeedPost Video Scheduler - Client Application Logic (Multi-Tenant SaaS + Meta OAuth)

const DEFAULT_API_KEY = 'spk_zY8ug6teWCEUJ1ogKV3SNi4N_ebIYLFP';

const state = {
  apiKey: localStorage.getItem('speedpost_api_key') || DEFAULT_API_KEY,
  token: localStorage.getItem('speedpost_user_token') || null,
  user: null,
  userAccounts: [],
  workspaces: [],
  currentWorkspace: null,
  currentAccount: null,
  uploadedMedia: null, // { mediaId, url, type, size, name }
  selectedPlatform: 'INSTAGRAM',
  calendarPosts: [],
  filteredPosts: [],
  activeStatusFilter: 'all',
  publishedContent: [],
  analyticsData: null,
  analyticsPeriod: '30d',
  calendarView: 'list', // 'list' | 'month'
  currentMonthDate: new Date(2026, 9, 8),
  chartInstance: null,
  authMode: 'login' // 'login' | 'register'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  initDefaultScheduleDateTime();
  setupEventListeners();

  // Check URL params for Meta callback result
  checkMetaCallbackUrl();

  // Fetch Initial Data
  await checkApiHealth();
  await loadUserProfile();
  await loadWorkspaces();
  await loadUserConnectedAccounts();
  await loadCalendarPosts();
  await loadAccountAnalytics();
  await loadPublishedContent();

  lucide.createIcons();
});

// Helper for Fetch API with custom API key and JWT auth header
async function apiFetch(url, options = {}) {
  const headers = {
    'x-api-key': state.apiKey,
    ...(options.headers || {})
  };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  return fetch(url, { ...options, headers });
}

// ----------------------------------------------------
// TAB NAVIGATION
// ----------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
  
  const target = document.getElementById(`section-${tabId}`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.remove('bg-brand-600', 'text-white', 'shadow-sm');
    btn.classList.add('text-gray-400');
  });
  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  if (activeBtn) {
    activeBtn.classList.remove('text-gray-400');
    activeBtn.classList.add('bg-brand-600', 'text-white', 'shadow-sm');
  }

  ['studio', 'calendar', 'accounts', 'content', 'analytics', 'settings'].forEach(id => {
    const mBtn = document.getElementById(`m-tab-${id}`);
    if (mBtn) {
      if (id === tabId) {
        mBtn.classList.add('text-brand-400');
        mBtn.classList.remove('text-gray-400');
      } else {
        mBtn.classList.remove('text-brand-400');
        mBtn.classList.add('text-gray-400');
      }
    }
  });

  lucide.createIcons();

  if (tabId === 'calendar') renderCalendar();
  if (tabId === 'accounts') loadUserConnectedAccounts();
  if (tabId === 'analytics' && state.analyticsData) renderAnalyticsChart();
}

// ----------------------------------------------------
// AUTENTICAÇÃO DE USUÁRIOS (SaaS Multi-Tenant)
// ----------------------------------------------------
async function loadUserProfile() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
      state.userAccounts = data.accounts || [];
      updateUserAuthHeader();
    } else {
      state.user = null;
      state.token = null;
      localStorage.removeItem('speedpost_user_token');
      updateUserAuthHeader();
    }
  } catch (err) {
    console.warn('Auth check error:', err);
    updateUserAuthHeader();
  }
}

function updateUserAuthHeader() {
  const container = document.getElementById('user-auth-header-container');
  if (!container) return;

  if (state.user) {
    const initials = state.user.name ? state.user.name.substring(0, 2).toUpperCase() : 'US';
    container.innerHTML = `
      <div class="flex items-center gap-2 bg-dark-950/80 p-1 pl-2.5 rounded-xl border border-white/10">
        <div class="text-right hidden sm:block">
          <p class="text-xs font-bold text-white leading-tight">${state.user.name}</p>
          <span class="text-[10px] uppercase font-bold text-brand-300 bg-brand-500/20 px-1.5 py-0.2 rounded font-mono">${state.user.plan || 'PRO'}</span>
        </div>
        <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shadow-sm">
          ${initials}
        </div>
        <button onclick="logout()" class="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-white/5 transition-colors" title="Sair da Conta">
          <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button onclick="openAuthModal('login')" class="px-3.5 py-1.5 rounded-xl bg-dark-900 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold flex items-center gap-1.5 transition-all">
        <i data-lucide="user" class="w-3.5 h-3.5"></i> Entrar
      </button>
    `;
  }
  lucide.createIcons();
}

function openAuthModal(mode = 'login') {
  setAuthMode(mode);
  const modal = document.getElementById('modal-auth');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeAuthModal() {
  const modal = document.getElementById('modal-auth');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  document.getElementById('auth-error-msg').classList.add('hidden');
}

function setAuthMode(mode) {
  state.authMode = mode;
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const nameContainer = document.getElementById('auth-name-container');
  const modalTitle = document.getElementById('auth-modal-title');
  const submitText = document.getElementById('auth-submit-text');
  const errorMsg = document.getElementById('auth-error-msg');
  errorMsg.classList.add('hidden');

  if (mode === 'login') {
    tabLogin.className = 'py-2 rounded-lg bg-brand-600 text-white shadow-sm transition-all';
    tabRegister.className = 'py-2 rounded-lg text-gray-400 hover:text-white transition-all';
    nameContainer.classList.add('hidden');
    modalTitle.textContent = 'Acessar sua Conta';
    submitText.textContent = 'Entrar no Studio';
  } else {
    tabRegister.className = 'py-2 rounded-lg bg-brand-600 text-white shadow-sm transition-all';
    tabLogin.className = 'py-2 rounded-lg text-gray-400 hover:text-white transition-all';
    nameContainer.classList.remove('hidden');
    modalTitle.textContent = 'Criar Conta de Usuário';
    submitText.textContent = 'Cadastrar e Começar Grátis';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const errorMsg = document.getElementById('auth-error-msg');
  errorMsg.classList.add('hidden');

  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  const name = document.getElementById('auth-name').value.trim();

  const isRegister = state.authMode === 'register';
  const url = isRegister ? '/api/auth/register' : '/api/auth/login';
  const payload = isRegister ? { name, email, password } : { email, password };

  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.token) {
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('speedpost_user_token', data.token);

      showToast(data.message || 'Login realizado!', 'success');
      closeAuthModal();
      updateUserAuthHeader();

      // Refresh data for logged in user
      await loadUserConnectedAccounts();
      await loadCalendarPosts();
    } else {
      throw new Error(data.error || 'Falha ao autenticar.');
    }
  } catch (err) {
    errorMsg.textContent = err.message;
    errorMsg.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('speedpost_user_token');
  showToast('Você saiu da sua conta.', 'info');
  updateUserAuthHeader();
  loadUserConnectedAccounts();
  loadCalendarPosts();
}

// ----------------------------------------------------
// ABORDAGEM 1: META & INSTAGRAM OAUTH DIRETO
// ----------------------------------------------------
async function initiateMetaOAuth() {
  try {
    const res = await apiFetch('/api/auth/meta/url');
    const data = await res.json();

    if (data.configured && data.url) {
      showToast('Redirecionando para autorização oficial da Meta...', 'info');
      setTimeout(() => {
        window.location.href = data.url;
      }, 800);
    } else {
      // Keys not configured yet in .env - inform user and open instant sandbox modal
      showToast('Credenciais da Meta ainda não configuradas no .env. Use o Modo Sandbox!', 'warning');
      openMockConnectModal();
    }
  } catch (err) {
    console.error('Meta OAuth URL error:', err);
    showToast('Erro ao iniciar fluxo Meta: ' + err.message, 'error');
  }
}

function checkMetaCallbackUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('meta_connected') === 'success') {
    const added = urlParams.get('accounts_added') || '1';
    showToast(`🎉 Sucesso! ${added} conta(s) do Instagram conectada(s) via Meta OAuth!`, 'success');
    window.history.replaceState({}, document.title, window.location.pathname);
    switchTab('accounts');
  } else if (urlParams.get('meta_error')) {
    const err = urlParams.get('meta_error');
    showToast(`Erro na autorização da Meta: ${err}`, 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

// Sandbox Mock Connect Modal
function openMockConnectModal() {
  const modal = document.getElementById('modal-mock-connect');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeMockConnectModal() {
  const modal = document.getElementById('modal-mock-connect');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function handleMockConnectSubmit(e) {
  e.preventDefault();
  const username = document.getElementById('mock-username').value.trim();
  const name = document.getElementById('mock-name').value.trim();
  const followers = document.getElementById('mock-followers').value.trim();

  const btn = document.getElementById('btn-mock-connect-submit');
  btn.disabled = true;

  try {
    const res = await apiFetch('/api/auth/meta/mock-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, name, followers, platform: 'INSTAGRAM' })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Conta ${username} vinculada ao seu usuário com sucesso!`, 'success');
      closeMockConnectModal();
      document.getElementById('mock-username').value = '';
      await loadUserConnectedAccounts();
    } else {
      throw new Error(data.error || 'Erro ao conectar conta.');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Load Connected Accounts for Current User
async function loadUserConnectedAccounts() {
  try {
    const res = await apiFetch('/api/user/accounts');
    const data = await res.json();
    const accounts = data.accounts || [];
    state.userAccounts = accounts;

    document.getElementById('user-accounts-count').textContent = accounts.length;
    renderUserConnectedAccounts(accounts);

    // Update Studio Account Select Dropdown
    const selectAcc = document.getElementById('select-account');
    if (accounts.length > 0) {
      selectAcc.innerHTML = accounts.map(a => `
        <option value="${a.id}">${a.username} (${a.platform} - ${formatNumber(a.followers_count || 0)} seg)</option>
      `).join('');

      // Set active account to first one if not set
      if (!state.currentAccount || !accounts.find(a => a.id === state.currentAccount.id)) {
        state.currentAccount = accounts[0];
        document.getElementById('account-username').textContent = accounts[0].username;
        document.getElementById('account-followers').textContent = formatNumber(accounts[0].followers_count || 0);
      }
    } else {
      selectAcc.innerHTML = `<option value="cmqwqytic2po99xgdlf08vnc1">@cenasqueamo._ (Padrão)</option>`;
    }
  } catch (err) {
    console.error('Error loading user accounts:', err);
  }
}

function renderUserConnectedAccounts(accounts) {
  const grid = document.getElementById('user-connected-accounts-grid');
  if (!grid) return;

  if (accounts.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full glass-panel rounded-2xl p-8 text-center text-gray-400 border border-white/5">
        <i data-lucide="share-2" class="w-10 h-10 mx-auto text-gray-500 mb-2"></i>
        <p class="text-sm font-bold text-white">Nenhuma rede social conectada ainda</p>
        <p class="text-xs text-gray-400 mt-1">Clique em "Conectar via Meta OAuth" acima para adicionar seu Instagram ou Facebook.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = accounts.map(acc => {
    return `
      <div class="glass-panel rounded-2xl p-5 border border-white/10 flex flex-col justify-between interactive-card">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-500 to-purple-600 p-0.5 overflow-hidden shrink-0 shadow-md">
              <img src="${acc.profile_picture_url || 'https://api.dicebear.com/7.x/identicon/svg?seed=' + acc.username}" alt="${acc.username}" class="w-full h-full object-cover rounded-[14px]" />
            </div>
            <div>
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-bold text-white">${acc.username}</span>
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              </div>
              <p class="text-[11px] text-gray-400 truncate max-w-[140px]">${acc.name || 'Conta Conectada'}</p>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-300 border border-pink-500/20 text-[10px] font-bold">
            ${acc.platform}
          </span>
        </div>

        <div class="pt-3 border-t border-white/5 flex items-center justify-between">
          <div class="text-xs">
            <span class="text-gray-400">Seguidores:</span>
            <span class="font-bold text-brand-300 ml-1">${formatNumber(acc.followers_count || 0)}</span>
          </div>

          <button onclick="disconnectAccount('${acc.id}')" class="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-white/5 transition-colors" title="Desconectar conta">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

async function disconnectAccount(accountId) {
  if (!confirm('Deseja realmente desconectar esta rede social do seu usuário?')) return;

  try {
    const res = await apiFetch(`/api/user/accounts/${accountId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Conta desconectada com sucesso.', 'info');
      await loadUserConnectedAccounts();
    } else {
      throw new Error('Falha ao desconectar.');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------
// HEALTHCHECK & WORKSPACES
// ----------------------------------------------------
async function checkApiHealth() {
  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();
    const pill = document.getElementById('api-status-pill');
    const text = document.getElementById('api-status-text');
    const lat = document.getElementById('api-latency');

    if (data.success) {
      text.textContent = 'SpeedPost Online';
      lat.textContent = `${data.latencyMs}ms`;
      pill.className = 'flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium';
    } else {
      text.textContent = 'Erro de Conexão';
      lat.textContent = 'Offline';
      pill.className = 'flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium';
    }
  } catch (e) {
    console.error('Healthcheck error:', e);
  }
}

async function loadWorkspaces() {
  try {
    const res = await apiFetch('/api/workspaces');
    const data = await res.json();
    if (data.workspaces && data.workspaces.length > 0) {
      state.workspaces = data.workspaces;
      state.currentWorkspace = data.workspaces[0];
      
      const selectWs = document.getElementById('select-workspace');
      if (selectWs) {
        selectWs.innerHTML = data.workspaces.map(w => `
          <option value="${w.id}">${w.name} (${w.id.substring(0, 10)}...)</option>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Error loading workspaces:', err);
  }
}

// ----------------------------------------------------
// SCHEDULING STUDIO & VIDEO UPLOAD
// ----------------------------------------------------
function setupEventListeners() {
  const captionInput = document.getElementById('caption-input');
  captionInput.addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('char-count').textContent = val.length;
    const previewCaption = document.getElementById('preview-caption-text');
    previewCaption.textContent = val.trim() || 'Escreva a legenda no formulário ao lado para acompanhar em tempo real...';
  });

  const dateInput = document.getElementById('schedule-date');
  const timeInput = document.getElementById('schedule-time');
  const updateUtc = () => {
    if (dateInput.value && timeInput.value) {
      const localDate = new Date(`${dateInput.value}T${timeInput.value}`);
      const utcIso = localDate.toISOString();
      document.getElementById('utc-preview').textContent = utcIso;
      
      const formattedBr = localDate.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      document.getElementById('mockup-sched-tag').textContent = `Programado para ${formattedBr}`;
      document.getElementById('phone-clock').textContent = timeInput.value;
    }
  };
  dateInput.addEventListener('change', updateUtc);
  timeInput.addEventListener('change', updateUtc);

  document.querySelectorAll('input[name="post_platform"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.selectedPlatform = e.target.value;
      document.querySelectorAll('.platform-card').forEach(c => {
        c.classList.remove('border-brand-500/50', 'bg-brand-500/10');
        c.classList.add('border-white/5', 'bg-dark-900/50');
      });
      e.target.closest('.platform-card').classList.add('border-brand-500/50', 'bg-brand-500/10');
      e.target.closest('.platform-card').classList.remove('border-white/5', 'bg-dark-900/50');
    });
  });

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('video-file-input');

  dropZone.addEventListener('click', () => {
    if (!state.uploadedMedia) fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-brand-500', 'bg-brand-500/5');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-brand-500', 'bg-brand-500/5');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-brand-500', 'bg-brand-500/5');
    if (e.dataTransfer.files.length > 0) {
      handleVideoFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleVideoFile(e.target.files[0]);
    }
  });
}

function initDefaultScheduleDateTime() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yyyy = tomorrow.getFullYear();
  const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const dd = String(tomorrow.getDate()).padStart(2, '0');

  document.getElementById('schedule-date').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('schedule-time').value = '18:00';
  
  const localDate = new Date(`${yyyy}-${mm}-${dd}T18:00`);
  document.getElementById('utc-preview').textContent = localDate.toISOString();
  document.getElementById('mockup-sched-tag').textContent = `Programado para ${dd}/${mm} 18:00`;
}

function setPresetTime(preset) {
  const now = new Date();
  let targetDate = new Date();
  let targetTime = '18:00';

  if (preset === 'today-18') {
    targetTime = '18:00';
  } else if (preset === 'today-21') {
    targetTime = '21:00';
  } else if (preset === 'tomorrow-12') {
    targetDate.setDate(now.getDate() + 1);
    targetTime = '12:00';
  } else if (preset === 'tomorrow-18') {
    targetDate.setDate(now.getDate() + 1);
    targetTime = '18:00';
  }

  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');

  document.getElementById('schedule-date').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('schedule-time').value = targetTime;
  
  const fullDate = new Date(`${yyyy}-${mm}-${dd}T${targetTime}`);
  document.getElementById('utc-preview').textContent = fullDate.toISOString();
  document.getElementById('mockup-sched-tag').textContent = `Programado para ${dd}/${mm} ${targetTime}`;
  document.getElementById('phone-clock').textContent = targetTime;
  
  showToast('Horário predefinido selecionado!', 'info');
}

async function handleVideoFile(file) {
  if (!file.type.startsWith('video/')) {
    showToast('Por favor, selecione um arquivo de vídeo válido (.mp4, .mov, .webm).', 'error');
    return;
  }

  if (file.size > 500 * 1024 * 1024) {
    showToast('O arquivo excede o limite máximo permitido de 500MB.', 'error');
    return;
  }

  const previewVideo = document.getElementById('preview-video');
  const placeholder = document.getElementById('preview-video-placeholder');
  const objectUrl = URL.createObjectURL(file);
  previewVideo.src = objectUrl;
  previewVideo.play().catch(() => {});
  placeholder.classList.add('hidden');

  document.getElementById('upload-idle-state').classList.add('hidden');
  document.getElementById('upload-progress-state').classList.remove('hidden');
  document.getElementById('upload-success-state').classList.add('hidden');

  const uploadBar = document.getElementById('upload-bar-fill');
  const uploadPercentage = document.getElementById('upload-percentage');

  let progress = 10;
  uploadBar.style.width = '10%';
  uploadPercentage.textContent = '10%';

  const interval = setInterval(() => {
    if (progress < 85) {
      progress += Math.floor(Math.random() * 12) + 5;
      if (progress > 85) progress = 85;
      uploadBar.style.width = `${progress}%`;
      uploadPercentage.textContent = `${progress}%`;
    }
  }, 300);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'video');

  try {
    const res = await apiFetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    clearInterval(interval);
    const data = await res.json();

    if (res.ok && data.mediaId) {
      uploadBar.style.width = '100%';
      uploadPercentage.textContent = '100%';

      setTimeout(() => {
        state.uploadedMedia = {
          mediaId: data.mediaId,
          url: data.url,
          type: data.type || 'video',
          size: data.size || file.size,
          name: file.name
        };

        document.getElementById('upload-progress-state').classList.add('hidden');
        document.getElementById('upload-success-state').classList.remove('hidden');
        document.getElementById('uploaded-filename').textContent = file.name;
        document.getElementById('uploaded-filesize').textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

        showToast('Vídeo enviado com sucesso para o armazenamento!', 'success');
        lucide.createIcons();
      }, 400);

    } else {
      throw new Error(data.error || data.message || 'Falha ao processar vídeo.');
    }
  } catch (err) {
    clearInterval(interval);
    console.error('Upload error:', err);
    resetVideoUpload();
    showToast(`Erro no upload: ${err.message}`, 'error');
  }
}

async function loadSampleVideo() {
  try {
    showToast('Carregando vídeo demonstrativo...', 'info');
    const response = await fetch('/samples/demo.mp4');
    const blob = await response.blob();
    const file = new File([blob], 'trailer_demo.mp4', { type: 'video/mp4' });

    const sampleCaption = `Uma das cenas mais marcantes da história do cinema! 🍿🎬\n\nVocê já assistiu a esse clássico? Comente abaixo a sua opinião!\n\n#cinema #filmes #cenasqueamo #reels #curiosidades`;
    document.getElementById('caption-input').value = sampleCaption;
    document.getElementById('char-count').textContent = sampleCaption.length;
    document.getElementById('preview-caption-text').textContent = sampleCaption;

    await handleVideoFile(file);
  } catch (e) {
    console.error('Error loading sample video:', e);
    showToast('Falha ao carregar amostra: ' + e.message, 'error');
  }
}

function resetVideoUpload() {
  state.uploadedMedia = null;
  document.getElementById('video-file-input').value = '';
  document.getElementById('upload-idle-state').classList.remove('hidden');
  document.getElementById('upload-progress-state').classList.add('hidden');
  document.getElementById('upload-success-state').classList.add('hidden');
  
  const previewVideo = document.getElementById('preview-video');
  previewVideo.pause();
  previewVideo.src = '';
  document.getElementById('preview-video-placeholder').classList.remove('hidden');
}

function insertHashtag(tag) {
  const input = document.getElementById('caption-input');
  const val = input.value;
  input.value = val ? `${val} ${tag}` : tag;
  input.dispatchEvent(new Event('input'));
  input.focus();
}

function insertEmoji(emoji) {
  const input = document.getElementById('caption-input');
  const val = input.value;
  input.value = `${val} ${emoji}`;
  input.dispatchEvent(new Event('input'));
  input.focus();
}

async function submitSchedulePost() {
  if (!state.uploadedMedia || !state.uploadedMedia.mediaId) {
    showToast('Faça o upload de um vídeo antes de agendar.', 'warning');
    return;
  }

  const workspaceId = document.getElementById('select-workspace')?.value || 'cmqwqwvvf2pnp9xgds8emvo9c';
  const accountId = document.getElementById('select-account')?.value || (state.currentAccount && state.currentAccount.id) || 'cmqwqytic2po99xgdlf08vnc1';
  const caption = document.getElementById('caption-input').value.trim();
  const dateVal = document.getElementById('schedule-date').value;
  const timeVal = document.getElementById('schedule-time').value;

  if (!dateVal || !timeVal) {
    showToast('Informe a data e o horário para agendamento.', 'warning');
    return;
  }

  const localDate = new Date(`${dateVal}T${timeVal}`);
  const now = new Date();

  if (localDate.getTime() <= now.getTime() + 60000) {
    showToast('O agendamento precisa ser de pelo menos 1 minuto no futuro.', 'warning');
    return;
  }

  const scheduledAt = localDate.toISOString();

  const payload = {
    workspaceId,
    accountId,
    mediaId: state.uploadedMedia.mediaId,
    caption,
    scheduledAt,
    platform: state.selectedPlatform
  };

  const btn = document.getElementById('btn-submit-schedule');
  const btnText = document.getElementById('btn-schedule-text');
  btn.disabled = true;
  btnText.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin inline mr-1"></i> Agendando publicação...';
  lucide.createIcons();

  try {
    const res = await apiFetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      showToast('🎉 Vídeo agendado com sucesso!', 'success');
      
      resetVideoUpload();
      document.getElementById('caption-input').value = '';
      document.getElementById('caption-input').dispatchEvent(new Event('input'));

      await loadCalendarPosts();
      setTimeout(() => switchTab('calendar'), 1000);
    } else {
      throw new Error(data.error || data.message || 'Erro ao agendar post.');
    }
  } catch (err) {
    console.error('Error submitting post:', err);
    showToast(`Erro ao agendar: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Confirmar e Agendar Vídeo';
  }
}

// ----------------------------------------------------
// CALENDAR & QUEUE
// ----------------------------------------------------
async function loadCalendarPosts() {
  const refreshIcon = document.getElementById('calendar-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const wsId = state.currentWorkspace ? state.currentWorkspace.id : 'cmqwqwvvf2pnp9xgds8emvo9c';
    const res = await apiFetch(`/api/calendar?workspaceId=${wsId}&limit=100`);
    const data = await res.json();

    if (data.posts) {
      state.calendarPosts = data.posts;
      updateFilterCounts();
      filterCalendar(state.activeStatusFilter);
    }
  } catch (err) {
    console.error('Error loading calendar:', err);
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

function updateFilterCounts() {
  const posts = state.calendarPosts;
  document.getElementById('count-all').textContent = posts.length;
  document.getElementById('count-scheduled').textContent = posts.filter(p => p.status === 'scheduled').length;
  document.getElementById('count-published').textContent = posts.filter(p => p.status === 'published').length;
  document.getElementById('count-cancelled').textContent = posts.filter(p => p.status === 'cancelled').length;
}

function filterCalendar(status) {
  state.activeStatusFilter = status;

  document.querySelectorAll('.cal-filter-btn').forEach(b => {
    b.classList.remove('active', 'bg-brand-500/20', 'text-brand-300', 'border-brand-500/30');
    b.classList.add('bg-dark-900', 'text-gray-300', 'border-white/5');
  });
  event?.target?.closest('.cal-filter-btn')?.classList.add('active', 'bg-brand-500/20', 'text-brand-300', 'border-brand-500/30');

  if (status === 'all') {
    state.filteredPosts = [...state.calendarPosts];
  } else {
    state.filteredPosts = state.calendarPosts.filter(p => p.status === status);
  }

  renderCalendar();
}

function searchCalendar(query) {
  const q = query.toLowerCase().trim();
  if (!q) {
    filterCalendar(state.activeStatusFilter);
    return;
  }
  state.filteredPosts = state.calendarPosts.filter(p => 
    (p.caption && p.caption.toLowerCase().includes(q)) || 
    (p.id && p.id.toLowerCase().includes(q))
  );
  renderCalendar();
}

function setCalendarView(view) {
  state.calendarView = view;
  const listBtn = document.getElementById('view-btn-list');
  const monthBtn = document.getElementById('view-btn-month');
  const listView = document.getElementById('calendar-view-list');
  const monthView = document.getElementById('calendar-view-month');

  if (view === 'list') {
    listBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white transition-all flex items-center gap-1.5';
    monthBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-all flex items-center gap-1.5';
    listView.classList.remove('hidden');
    monthView.classList.add('hidden');
  } else {
    monthBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 text-white transition-all flex items-center gap-1.5';
    listBtn.className = 'px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-all flex items-center gap-1.5';
    monthView.classList.remove('hidden');
    listView.classList.add('hidden');
    renderMonthView();
  }
  lucide.createIcons();
}

function renderCalendar() {
  if (state.calendarView === 'month') {
    renderMonthView();
  } else {
    renderListView();
  }
}

function renderListView() {
  const container = document.getElementById('calendar-posts-list');
  const posts = state.filteredPosts;

  if (posts.length === 0) {
    container.innerHTML = `
      <div class="glass-panel rounded-2xl p-12 text-center text-gray-400">
        <i data-lucide="inbox" class="w-10 h-10 mx-auto text-gray-500 mb-3"></i>
        <h4 class="font-bold text-white text-base">Nenhum post encontrado</h4>
        <p class="text-xs text-gray-400 mt-1">Nenhum post corresponde aos filtros selecionados.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = posts.map(post => {
    const isScheduled = post.status === 'scheduled';
    const isPublished = post.status === 'published';
    const isCancelled = post.status === 'cancelled';

    let badgeClass = 'bg-gray-500/10 text-gray-400 border-gray-500/20';
    let statusLabel = 'Desconhecido';

    if (isScheduled) {
      badgeClass = 'bg-brand-500/15 text-brand-300 border-brand-500/30';
      statusLabel = 'Agendado';
    } else if (isPublished) {
      badgeClass = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      statusLabel = 'Publicado';
    } else if (isCancelled) {
      badgeClass = 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      statusLabel = 'Cancelado';
    }

    const postDate = new Date(post.scheduled_at || post.scheduledAt || post.publishedAt);
    const dateFormatted = postDate.toLocaleString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const snippet = post.caption ? (post.caption.length > 180 ? post.caption.substring(0, 180) + '...' : post.caption) : 'Sem legenda';

    return `
      <div class="glass-panel rounded-2xl p-5 transition-all hover:border-white/15 interactive-card flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        
        <div class="flex items-start gap-4 flex-1">
          <div class="w-14 h-16 rounded-xl bg-dark-950 border border-white/10 flex items-center justify-center shrink-0 text-brand-400 relative overflow-hidden group">
            <i data-lucide="film" class="w-6 h-6"></i>
          </div>

          <div class="space-y-1.5 flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase ${badgeClass}">
                ${statusLabel}
              </span>
              <span class="text-xs font-semibold text-white flex items-center gap-1">
                <i data-lucide="clock" class="w-3.5 h-3.5 text-gray-400"></i> ${dateFormatted}
              </span>
              <span class="text-[10px] text-gray-500 font-mono">ID: ${(post.id || '').substring(0, 12)}...</span>
            </div>

            <p class="text-xs text-gray-300 leading-relaxed break-words">${snippet}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end pt-3 md:pt-0 border-t md:border-t-0 border-white/5">
          <button onclick="openPostModal('${post.id}')" class="px-3 py-1.5 rounded-xl bg-dark-900 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-300 flex items-center gap-1.5 transition-colors">
            <i data-lucide="eye" class="w-3.5 h-3.5"></i> Detalhes
          </button>

          ${isScheduled ? `
            <button onclick="checkPostStatus('${post.id}')" class="p-2 rounded-xl bg-dark-900 hover:bg-white/10 border border-white/10 text-brand-300 text-xs transition-colors" title="Verificar status">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
            </button>
            <button onclick="cancelPost('${post.id}')" class="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs font-medium flex items-center gap-1 transition-colors">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Cancelar
            </button>
          ` : ''}
        </div>

      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function renderMonthView() {
  const grid = document.getElementById('calendar-grid');
  const d = state.currentMonthDate;
  const year = d.getFullYear();
  const month = d.getMonth();

  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  document.getElementById('month-title').textContent = `${monthNames[month]} ${year}`;

  const firstDayIndex = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let html = '';

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    html += `<div class="p-2 min-h-[90px] rounded-xl bg-dark-950/20 text-gray-600 text-xs border border-white/[0.02]">${daysInPrevMonth - i}</div>`;
  }

  for (day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const postsOnDay = state.calendarPosts.filter(p => {
      const pDate = (p.scheduled_at || p.scheduledAt || p.publishedAt || '').substring(0, 10);
      return pDate === dayStr;
    });

    const isToday = day === 8 && month === 9 && year === 2026;

    html += `
      <div class="p-2 min-h-[95px] rounded-xl bg-dark-950/60 border ${isToday ? 'border-brand-500 bg-brand-500/5' : 'border-white/5'} text-xs flex flex-col justify-between hover:border-white/20 transition-all cursor-pointer">
        <div class="flex items-center justify-between">
          <span class="font-bold ${isToday ? 'text-brand-400 font-black' : 'text-gray-300'}">${day}</span>
          ${postsOnDay.length > 0 ? `<span class="text-[10px] font-mono px-1.5 rounded-full bg-brand-500/20 text-brand-300">${postsOnDay.length}</span>` : ''}
        </div>

        <div class="space-y-1 mt-1 overflow-hidden">
          ${postsOnDay.slice(0, 2).map(p => {
            const isPub = p.status === 'published';
            return `
              <div onclick="openPostModal('${p.id}')" class="px-1.5 py-0.5 rounded text-[10px] truncate ${isPub ? 'bg-emerald-500/20 text-emerald-300' : 'bg-brand-500/20 text-brand-300'} font-medium">
                ${p.caption ? p.caption.substring(0, 18) + '...' : 'Vídeo'}
              </div>
            `;
          }).join('')}
          ${postsOnDay.length > 2 ? `<div class="text-[9px] text-gray-500">+${postsOnDay.length - 2} mais</div>` : ''}
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
}

function prevMonth() {
  state.currentMonthDate.setMonth(state.currentMonthDate.getMonth() - 1);
  renderMonthView();
}
function nextMonth() {
  state.currentMonthDate.setMonth(state.currentMonthDate.getMonth() + 1);
  renderMonthView();
}
function goToCurrentMonth() {
  state.currentMonthDate = new Date(2026, 9, 8);
  renderMonthView();
}

async function checkPostStatus(postId) {
  try {
    const res = await apiFetch(`/api/posts/${postId}`);
    const data = await res.json();
    showToast(`Status atual: ${data.status || 'OK'}`, 'info');
    await loadCalendarPosts();
  } catch (err) {
    showToast(`Erro ao checar status: ${err.message}`, 'error');
  }
}

async function cancelPost(postId) {
  if (!confirm('Deseja realmente cancelar este agendamento?')) return;

  try {
    const res = await apiFetch(`/api/posts/${postId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      showToast('Post cancelado com sucesso!', 'success');
      await loadCalendarPosts();
    } else {
      throw new Error(data.error || data.message || 'Erro ao cancelar');
    }
  } catch (err) {
    showToast(`Erro ao cancelar: ${err.message}`, 'error');
  }
}

// ----------------------------------------------------
// PUBLISHED CONTENT & METRICS
// ----------------------------------------------------
async function loadPublishedContent() {
  const refreshIcon = document.getElementById('content-refresh-icon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const accId = state.currentAccount ? state.currentAccount.id : 'cmqwqytic2po99xgdlf08vnc1';
    const res = await apiFetch(`/api/content/account/${accId}?limit=30`);
    const data = await res.json();

    if (data.items) {
      state.publishedContent = data.items;
      renderPublishedContent();
    }
  } catch (err) {
    console.error('Error loading published content:', err);
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

function renderPublishedContent() {
  const grid = document.getElementById('published-content-grid');
  const items = state.publishedContent;

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full glass-panel rounded-2xl p-12 text-center text-gray-400">
        <i data-lucide="video-off" class="w-10 h-10 mx-auto text-gray-500 mb-3"></i>
        <h4 class="font-bold text-white text-base">Nenhum post publicado</h4>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = items.map(item => {
    const pubDate = new Date(item.publishedAt).toLocaleString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const captionSnippet = item.caption ? (item.caption.length > 120 ? item.caption.substring(0, 120) + '...' : item.caption) : 'Sem legenda';

    return `
      <div class="glass-panel rounded-2xl overflow-hidden interactive-card flex flex-col justify-between">
        <div class="relative h-56 bg-black flex items-center justify-center overflow-hidden group">
          ${item.thumbnailUrl ? `
            <img src="${item.thumbnailUrl}" alt="Thumbnail" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          ` : `
            <div class="w-full h-full bg-dark-900 flex items-center justify-center text-gray-600">
              <i data-lucide="film" class="w-12 h-12"></i>
            </div>
          `}
          
          <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none"></div>

          <div class="absolute top-3 left-3 z-10 flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-white text-[10px] font-bold border border-white/10 flex items-center gap-1">
              <i data-lucide="instagram" class="w-3 h-3 text-pink-400"></i> Reel
            </span>
          </div>

          ${item.permalink ? `
            <a href="${item.permalink}" target="_blank" rel="noopener noreferrer" class="absolute bottom-3 right-3 z-10 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg">
              <span>Instagram</span>
              <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
            </a>
          ` : ''}
        </div>

        <div class="p-5 space-y-4 flex-1 flex flex-col justify-between">
          <div>
            <div class="text-[11px] text-gray-400 font-mono mb-1.5 flex items-center gap-1">
              <i data-lucide="calendar" class="w-3-3 text-brand-400"></i> ${pubDate}
            </div>
            <p class="text-xs text-gray-300 leading-relaxed line-clamp-3">${captionSnippet}</p>
          </div>

          <div class="pt-3 border-t border-white/5 grid grid-cols-3 gap-2 text-center">
            <div class="p-2 rounded-xl bg-dark-950/70 border border-white/5">
              <span class="text-[10px] text-gray-400 block">Views</span>
              <span class="text-xs font-bold text-white">${formatNumber(item.views || 0)}</span>
            </div>
            <div class="p-2 rounded-xl bg-dark-950/70 border border-white/5">
              <span class="text-[10px] text-gray-400 block">Alcance</span>
              <span class="text-xs font-bold text-white">${formatNumber(item.reach || 0)}</span>
            </div>
            <div class="p-2 rounded-xl bg-dark-950/70 border border-white/5">
              <span class="text-[10px] text-gray-400 block">Likes</span>
              <span class="text-xs font-bold text-pink-400">${formatNumber(item.likes || 0)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

// ----------------------------------------------------
// ANALYTICS & CHARTS
// ----------------------------------------------------
async function loadAccountAnalytics() {
  try {
    const accId = state.currentAccount ? state.currentAccount.id : 'cmqwqytic2po99xgdlf08vnc1';
    const res = await apiFetch(`/api/analytics/account/${accId}?period=${state.analyticsPeriod}`);
    const data = await res.json();

    if (data) {
      state.analyticsData = data;
      
      if (data.followers) document.getElementById('stat-followers').textContent = data.followers.toLocaleString('pt-BR');
      if (data.followersGrowth !== undefined) {
        document.getElementById('stat-followers-growth').textContent = `+${data.followersGrowth} no período`;
      }
      if (data.views) document.getElementById('stat-views').textContent = data.views.toLocaleString('pt-BR');
      if (data.reach) document.getElementById('stat-reach').textContent = data.reach.toLocaleString('pt-BR');
      if (data.engagement?.likes) document.getElementById('stat-likes').textContent = data.engagement.likes.toLocaleString('pt-BR');

      document.getElementById('account-followers').textContent = formatNumber(data.followers || 183503);
      renderAnalyticsChart();
    }
  } catch (err) {
    console.error('Error loading analytics:', err);
  }
}

function changeAnalyticsPeriod(period) {
  state.analyticsPeriod = period;
  ['7d', '30d', '90d'].forEach(p => {
    const btn = document.getElementById(`period-btn-${p}`);
    if (p === period) {
      btn.className = 'px-3 py-1 rounded-lg text-xs font-medium bg-brand-600 text-white transition-all';
    } else {
      btn.className = 'px-3 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-white transition-all';
    }
  });
  loadAccountAnalytics();
}

function renderAnalyticsChart() {
  const canvas = document.getElementById('analytics-chart');
  if (!canvas || !state.analyticsData?.daily) return;

  const daily = state.analyticsData.daily;
  const labels = daily.map(d => {
    const parts = d.date.split('-');
    return `${parts[2]}/${parts[1]}`;
  });
  const views = daily.map(d => d.views || 0);
  const reach = daily.map(d => d.reach || 0);

  if (state.chartInstance) {
    state.chartInstance.destroy();
  }

  const ctx = canvas.getContext('2d');
  
  const viewsGradient = ctx.createLinearGradient(0, 0, 0, 300);
  viewsGradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
  viewsGradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

  const reachGradient = ctx.createLinearGradient(0, 0, 0, 300);
  reachGradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
  reachGradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Visualizações',
          data: views,
          borderColor: '#8b5cf6',
          backgroundColor: viewsGradient,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5
        },
        {
          label: 'Alcance Único',
          data: reach,
          borderColor: '#38bdf8',
          backgroundColor: reachGradient,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#9ca3af', font: { size: 11, family: 'Plus Jakarta Sans' } }
        },
        tooltip: {
          backgroundColor: '#171722',
          titleColor: '#fff',
          bodyColor: '#e5e7eb',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#6b7280', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#6b7280', font: { size: 10 } }
        }
      }
    }
  });
}

// ----------------------------------------------------
// SETTINGS & API KEY
// ----------------------------------------------------
function toggleApiKeyVisibility() {
  const input = document.getElementById('api-key-input');
  const icon = document.getElementById('eye-icon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-lucide', 'eye');
  }
  lucide.createIcons();
}

function saveApiKey() {
  const newKey = document.getElementById('api-key-input').value.trim();
  if (!newKey) {
    showToast('A chave da API não pode estar vazia.', 'warning');
    return;
  }
  state.apiKey = newKey;
  localStorage.setItem('speedpost_api_key', newKey);
  showToast('Chave de API salva com sucesso!', 'success');
  testApiConnection();
}

async function testApiConnection() {
  const resBox = document.getElementById('test-connection-result');
  const btn = document.getElementById('btn-test-api');
  btn.disabled = true;
  resBox.classList.remove('hidden');
  resBox.className = 'p-3.5 rounded-xl bg-dark-950 border border-white/10 text-xs text-gray-300';
  resBox.innerHTML = '<span class="flex items-center gap-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin text-brand-400"></i> Enviando requisição para SpeedPost...</span>';
  lucide.createIcons();

  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();

    if (data.success) {
      resBox.className = 'p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 space-y-1.5';
      resBox.innerHTML = `
        <div class="font-bold flex items-center gap-2">
          <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-400"></i> Conexão com SpeedPost estabelecida com sucesso!
        </div>
        <div class="text-[11px] text-emerald-400/80">
          Latência: <strong>${data.latencyMs}ms</strong> • Rate Limit Restante: <strong>${data.rateLimits.remaining}</strong>
        </div>
      `;
      showToast('Conexão com a SpeedPost verificada!', 'success');
    } else {
      throw new Error(data.message || 'Falha na autenticação.');
    }
  } catch (err) {
    resBox.className = 'p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300';
    resBox.innerHTML = `
      <div class="font-bold flex items-center gap-2">
        <i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400"></i> Erro na autenticação com a API SpeedPost
      </div>
      <div class="text-[11px] text-rose-400/80 mt-1">${err.message}</div>
    `;
    showToast('Erro ao validar chave de API.', 'error');
  } finally {
    btn.disabled = false;
    lucide.createIcons();
    await checkApiHealth();
  }
}

// ----------------------------------------------------
// MODAL: POST DETAIL
// ----------------------------------------------------
function openPostModal(postId) {
  const post = state.calendarPosts.find(p => p.id === postId);
  if (!post) return;

  const modal = document.getElementById('modal-post-detail');
  const videoPlayer = document.getElementById('modal-video-player');
  const statusEl = document.getElementById('modal-post-status');
  const dateEl = document.getElementById('modal-post-date');
  const idEl = document.getElementById('modal-post-id');
  const captionEl = document.getElementById('modal-post-caption');

  idEl.textContent = post.id;
  captionEl.textContent = post.caption || 'Sem legenda.';

  const postDate = new Date(post.scheduled_at || post.scheduledAt || post.publishedAt);
  dateEl.textContent = postDate.toLocaleString('pt-BR');

  if (post.status === 'scheduled') {
    statusEl.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/30';
    statusEl.textContent = 'Agendado';
  } else if (post.status === 'published') {
    statusEl.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    statusEl.textContent = 'Publicado';
  } else {
    statusEl.className = 'px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-500/20 text-gray-300 border border-gray-500/30';
    statusEl.textContent = post.status;
  }

  if (post.mediaUrl && post.mediaUrl.startsWith('http')) {
    videoPlayer.src = post.mediaUrl;
    videoPlayer.play().catch(() => {});
  } else {
    videoPlayer.src = '';
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closePostDetailModal() {
  const modal = document.getElementById('modal-post-detail');
  const videoPlayer = document.getElementById('modal-video-player');
  videoPlayer.pause();
  videoPlayer.src = '';
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// ----------------------------------------------------
// TOAST NOTIFICATIONS
// ----------------------------------------------------
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');

  let colors = 'bg-dark-900 border-white/10 text-white';
  let icon = 'info';

  if (type === 'success') {
    colors = 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200';
    icon = 'check-circle';
  } else if (type === 'error') {
    colors = 'bg-rose-950/90 border-rose-500/30 text-rose-200';
    icon = 'alert-octagon';
  } else if (type === 'warning') {
    colors = 'bg-amber-950/90 border-amber-500/30 text-amber-200';
    icon = 'alert-triangle';
  }

  toast.className = `p-3.5 rounded-xl border shadow-xl flex items-center gap-3 text-xs backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 pointer-events-auto ${colors}`;
  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
    <span class="flex-1 font-medium leading-tight">${message}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
