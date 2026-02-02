const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/connection');

router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  res.render('login', { title: 'Sign In — UAE', layout: 'auth' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(user.tenant_id);
  req.session.user = {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    tenant_id: user.tenant_id,
  };
  req.session.tenant = {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    mode: tenant.mode,
  };

  res.redirect('/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
