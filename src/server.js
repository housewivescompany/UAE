require('dotenv').config();
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── View engine ───────────────────────────────────────
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  layoutsDir: path.join(__dirname, '..', 'views', 'layouts'),
  partialsDir: path.join(__dirname, '..', 'views', 'partials'),
  helpers: require('./helpers/hbs-helpers'),
}));
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, '..', 'views'));

// ── Static files ──────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Body parsing ──────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ───────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'uae-dev-secret',
  resave: false,
  saveUninitialized: false,
}));
app.use(flash());

// ── Locals for templates ──────────────────────────────
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.user = req.session.user || null;
  res.locals.tenant = req.session.tenant || null;
  next();
});

// ── Routes ────────────────────────────────────────────
app.use('/', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/profiles', require('./routes/profiles'));
app.use('/contacts', require('./routes/contacts'));
app.use('/agents', require('./routes/agents'));
app.use('/integrations', require('./routes/integrations'));
app.use('/sentiment', require('./routes/sentiment'));
app.use('/api', require('./routes/api'));

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: '404 — Not Found' });
});

// ── Start ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`UAE running → http://localhost:${PORT}`);
});

module.exports = app;
