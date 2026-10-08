const jwt = require('jsonwebtoken');
const { get } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'speedpost_saas_super_secret_jwt_key_2026';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Token de autenticação não fornecido. Faça login para continuar.' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, name, email, plan, role, created_at FROM users WHERE id = ?', [decoded.id]);
    
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado. Faça login novamente.' });
  }
}

async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await get('SELECT id, name, email, plan, role, created_at FROM users WHERE id = ?', [decoded.id]);
      if (user) req.user = user;
    } catch {}
  }
  
  if (!req.user) {
    const defaultUser = await get('SELECT id, name, email, plan, role, created_at FROM users LIMIT 1');
    if (defaultUser) req.user = defaultUser;
  }
  next();
}

module.exports = {
  generateToken,
  requireAuth,
  optionalAuth,
  JWT_SECRET
};
