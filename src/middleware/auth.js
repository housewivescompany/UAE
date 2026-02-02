/**
 * Authentication middleware.
 */

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user || !roles.includes(req.session.user.role)) {
      req.flash('error', 'You do not have permission to access that page.');
      return res.redirect('/dashboard');
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
