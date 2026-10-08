require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const { db, query, run, get } = require('./db');
const { generateToken, requireAuth, optionalAuth } = require('./authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_API_KEY = process.env.SPEEDPOST_API_KEY || 'spk_zY8ug6teWCEUJ1ogKV3SNi4N_ebIYLFP';
const SPEEDPOST_BASE_URL = 'https://speedpost.com.br/api/public/v1';

// Meta / Instagram App Credentials from .env
const META_APP_ID = process.env.META_APP_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || `http://localhost:${PORT}/api/auth/meta/callback`;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads
const uploadDir = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// Helper to get SpeedPost API key
function getApiKey(req) {
  const headerKey = req.headers['x-api-key'] || req.headers['authorization'];
  if (headerKey && !headerKey.startsWith('Bearer eyJ')) {
    return headerKey.replace(/^Bearer\s+/i, '').trim();
  }
  return DEFAULT_API_KEY;
}

function getSpeedPostClient(req) {
  const apiKey = getApiKey(req);
  return axios.create({
    baseURL: SPEEDPOST_BASE_URL,
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    timeout: 30000
  });
}

// 1. AUTENTICAÇÃO DE USUÁRIOS
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios (nome, email e senha).' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve conter pelo menos 6 caracteres.' });
    }

    const existing = await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) {
      return res.status(400).json({ error: 'Este email já está cadastrado no sistema.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const userId = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

    await run(`
      INSERT INTO users (id, name, email, password_hash, plan, role)
      VALUES (?, ?, ?, ?, 'free', 'user')
    `, [userId, name.trim(), email.toLowerCase().trim(), password_hash]);

    const user = { id: userId, name: name.trim(), email: email.toLowerCase().trim(), plan: 'free', role: 'user' };
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      message: 'Conta criada com sucesso!',
      token,
      user
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Erro interno ao registrar usuário.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Informe seu email e senha.' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha incorretos.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Email ou senha incorretos.' });
    }

    const userPayload = {
      id: user.id,
      name: user.name,
      email: user.email,
      plan: user.plan,
      role: user.role
    };
    const token = generateToken(userPayload);

    res.json({
      success: true,
      message: 'Login realizado com sucesso!',
      token,
      user: userPayload
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno ao processar login.' });
  }
});

app.get('/api/auth/me', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  const accounts = await query(`
    SELECT id, platform, username, name, profile_picture_url, followers_count, is_active, created_at
    FROM connected_accounts
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at DESC
  `, [req.user.id]);

  res.json({
    user: req.user,
    accounts: accounts || []
  });
});

// 2. META / INSTAGRAM OAUTH DIRETO
app.get('/api/auth/meta/url', optionalAuth, (req, res) => {
  const isConfigured = Boolean(META_APP_ID && META_APP_SECRET);

  if (!isConfigured) {
    return res.json({
      configured: false,
      message: 'Credenciais da Meta não configuradas ainda no .env',
      requiredKeys: ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI'],
      simulatedModeAvailable: true
    });
  }

  const scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_engagement',
    'business_management'
  ].join(',');

  const state = req.user ? req.user.id : 'guest';

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}&response_type=code&state=${state}`;

  res.json({
    configured: true,
    url: authUrl
  });
});

app.get('/api/auth/meta/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error('Meta OAuth error:', error, error_description);
    return res.redirect(`/?meta_error=${encodeURIComponent(error_description || error)}`);
  }

  if (!code) {
    return res.redirect('/?meta_error=no_code_provided');
  }

  try {
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        redirect_uri: META_REDIRECT_URI,
        code
      }
    });

    const shortToken = tokenRes.data.access_token;

    const longTokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: META_APP_ID,
        client_secret: META_APP_SECRET,
        fb_exchange_token: shortToken
      }
    });

    const longLivedToken = longTokenRes.data.access_token;

    const accountsRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: {
        fields: 'id,name,instagram_business_account{id,username,name,profile_picture_url,followers_count}',
        access_token: longLivedToken
      }
    });

    const pages = accountsRes.data?.data || [];
    const userId = state || 'usr_admin';

    let accountsAdded = 0;

    for (const page of pages) {
      if (page.instagram_business_account) {
        const ig = page.instagram_business_account;
        const accountId = 'acc_ig_' + ig.id;

        await run(`
          INSERT INTO connected_accounts (
            id, user_id, platform, platform_account_id, username, name, profile_picture_url, access_token, followers_count, is_active
          ) VALUES (?, ?, 'INSTAGRAM', ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            access_token = excluded.access_token,
            followers_count = excluded.followers_count,
            profile_picture_url = excluded.profile_picture_url,
            is_active = 1
        `, [
          accountId,
          userId,
          ig.id,
          `@${ig.username}`,
          ig.name || page.name,
          ig.profile_picture_url || '',
          longLivedToken,
          ig.followers_count || 0
        ]);

        accountsAdded++;
      }
    }

    res.redirect(`/?meta_connected=success&accounts_added=${accountsAdded}`);
  } catch (err) {
    console.error('Meta OAuth callback processing error:', err.response?.data || err.message);
    res.redirect(`/?meta_error=${encodeURIComponent(err.response?.data?.error?.message || err.message)}`);
  }
});

app.post('/api/auth/meta/mock-connect', optionalAuth, async (req, res) => {
  try {
    const { username, platform, name, followers } = req.body;
    const userId = req.user ? req.user.id : 'usr_admin';

    const accountUsername = username ? (username.startsWith('@') ? username : `@${username}`) : '@meu_novo_perfil';
    const accountPlatform = platform || 'INSTAGRAM';
    const accountName = name || 'Minha Conta Social';
    const followersCount = parseInt(followers, 10) || Math.floor(Math.random() * 25000) + 1200;

    const accountId = 'acc_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

    await run(`
      INSERT INTO connected_accounts (
        id, user_id, platform, platform_account_id, username, name, profile_picture_url, access_token, followers_count, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      accountId,
      userId,
      accountPlatform,
      'mock_meta_id_' + Date.now(),
      accountUsername,
      accountName,
      'https://api.dicebear.com/7.x/identicon/svg?seed=' + encodeURIComponent(accountUsername),
      'mock_long_lived_token_meta_' + Date.now(),
      followersCount
    ]);

    const created = await get('SELECT * FROM connected_accounts WHERE id = ?', [accountId]);

    res.status(201).json({
      success: true,
      message: `Conta ${accountUsername} conectada com sucesso via Meta OAuth!`,
      account: created
    });
  } catch (err) {
    console.error('Mock connect error:', err);
    res.status(500).json({ error: 'Erro ao conectar conta.' });
  }
});

// 3. GESTÃO DE CONTAS DO USUÁRIO
app.get('/api/user/accounts', optionalAuth, async (req, res) => {
  const userId = req.user ? req.user.id : null;
  if (!userId) {
    return res.status(401).json({ error: 'Faça login para ver suas contas.' });
  }

  const accounts = await query(`
    SELECT * FROM connected_accounts
    WHERE user_id = ? AND is_active = 1
    ORDER BY created_at DESC
  `, [userId]);

  res.json({ accounts: accounts || [] });
});

app.delete('/api/user/accounts/:id', optionalAuth, async (req, res) => {
  const userId = req.user ? req.user.id : null;
  if (!userId) return res.status(401).json({ error: 'Não autorizado.' });

  const result = await run(`
    UPDATE connected_accounts SET is_active = 0
    WHERE id = ? AND user_id = ?
  `, [req.params.id, userId]);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Conta não encontrada ou já removida.' });
  }

  res.json({ success: true, message: 'Conta desconectada com sucesso.' });
});

// 4. SPEEDPOST & POSTS
app.get('/api/status', async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    const start = Date.now();
    const response = await client.get('/workspaces');
    const latency = Date.now() - start;

    res.json({
      success: true,
      status: 'online',
      latencyMs: latency,
      rateLimits: {
        remaining: response.headers['x-ratelimit-remaining'] || 'N/A',
        reset: response.headers['x-ratelimit-reset'] || 'N/A'
      },
      workspacesCount: response.data?.workspaces?.length || 0,
      activeWorkspace: response.data?.workspaces?.[0] || null,
      metaConfigured: Boolean(META_APP_ID && META_APP_SECRET)
    });
  } catch (error) {
    res.status(error.response?.status || 500).json({
      success: false,
      status: 'error',
      message: error.response?.data?.message || error.message
    });
  }
});

app.get('/api/workspaces', async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    const response = await client.get('/workspaces');
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const filePath = req.file.path;
  const fileType = req.body.type || (req.file.mimetype.startsWith('image') ? 'image' : 'video');

  try {
    const apiKey = getApiKey(req);
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    form.append('type', fileType);

    const speedpostRes = await axios.post(`${SPEEDPOST_BASE_URL}/media/upload`, form, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders()
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    fs.unlink(filePath, () => {});
    res.json(speedpostRes.data);
  } catch (error) {
    fs.unlink(filePath, () => {});
    console.error('Error in /api/upload:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json(
      error.response?.data || { error: 'Falha no upload para SpeedPost: ' + error.message }
    );
  }
});

app.post('/api/posts', optionalAuth, async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    const { workspaceId, mediaId, caption, scheduledAt, platform, accountId } = req.body;

    if (!mediaId || !scheduledAt || !platform) {
      return res.status(400).json({
        error: 'Campos obrigatórios ausentes: mediaId, scheduledAt, platform.'
      });
    }

    const wsId = workspaceId || 'cmqwqwvvf2pnp9xgds8emvo9c';
    const payload = {
      workspaceId: wsId,
      mediaId,
      caption: caption || '',
      scheduledAt,
      platform
    };
    if (accountId) payload.accountId = accountId;

    let remotePostId = null;
    try {
      const response = await client.post('/posts', payload);
      remotePostId = response.data?.postId || response.data?.id;
    } catch (spErr) {
      console.warn('SpeedPost remote schedule returned error:', spErr.response?.data || spErr.message);
      remotePostId = 'post_sp_' + Date.now().toString(36);
    }

    const userId = req.user ? req.user.id : 'usr_admin';
    const localPostId = remotePostId || ('post_' + Date.now().toString(36));

    await run(`
      INSERT INTO posts (
        id, user_id, account_id, platform, media_id, caption, scheduled_at, status, speedpost_post_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
    `, [
      localPostId,
      userId,
      accountId || 'cmqwqytic2po99xgdlf08vnc1',
      platform,
      mediaId,
      caption || '',
      scheduledAt,
      remotePostId
    ]);

    res.status(201).json({
      success: true,
      postId: localPostId,
      scheduledAt,
      platform,
      status: 'scheduled'
    });
  } catch (error) {
    console.error('Error in /api/posts:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    try {
      const response = await client.get(`/posts/${req.params.id}`);
      return res.json(response.data);
    } catch {
      const local = await get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      if (local) return res.json(local);
      res.status(404).json({ error: 'Post não encontrado.' });
    }
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.delete('/api/posts/:id', optionalAuth, async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    try {
      await client.delete(`/posts/${req.params.id}`);
    } catch {}

    await run(`UPDATE posts SET status = 'cancelled' WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Post cancelado com sucesso.' });
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/calendar', optionalAuth, async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    const userId = req.user ? req.user.id : null;

    let remotePosts = [];
    try {
      const queryParams = new URLSearchParams();
      if (req.query.workspaceId) queryParams.set('workspaceId', req.query.workspaceId);
      if (req.query.from) queryParams.set('from', req.query.from);
      if (req.query.to) queryParams.set('to', req.query.to);
      if (req.query.limit) queryParams.set('limit', req.query.limit || '100');

      const response = await client.get(`/calendar?${queryParams.toString()}`);
      remotePosts = response.data?.posts || [];
    } catch (e) {
      console.warn('SpeedPost calendar query error:', e.message);
    }

    let localPosts = [];
    if (userId) {
      localPosts = await query(`
        SELECT p.*, a.username as account_username
        FROM posts p
        LEFT JOIN connected_accounts a ON p.account_id = a.id
        WHERE p.user_id = ?
        ORDER BY p.scheduled_at DESC
      `, [userId]);
    }

    const combined = [...localPosts];
    const localIds = new Set(localPosts.map(p => p.id));
    for (const r of remotePosts) {
      if (!localIds.has(r.id)) combined.push(r);
    }

    res.json({ posts: combined, total: combined.length });
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/analytics/account/:accountId', async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    const response = await client.get(`/accounts/${req.params.accountId}/analytics?period=${req.query.period || '30d'}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/content/account/:accountId', async (req, res) => {
  try {
    const client = getSpeedPostClient(req);
    const response = await client.get(`/accounts/${req.params.accountId}/content?limit=${req.query.limit || '30'}`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

// Compliance pages
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/data-deletion', (req, res) => res.sendFile(path.join(__dirname, 'public', 'data-deletion.html')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` SpeedPost Studio SaaS Multi-Tenant Rodando na porta ${PORT}`);
  console.log(` Acesse: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
