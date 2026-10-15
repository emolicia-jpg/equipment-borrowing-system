module.exports = {
  // Ensure user is logged in
  isAuthenticated: (req, res, next) => {
    if (req.session && req.session.user) {
      return next();
    }
    req.flash ? req.flash('error', 'Please log in first.') : null;
    res.redirect('/auth/login');
  },

  // Authorize specific user roles
  authorizeRoles: (...roles) => {
    return (req, res, next) => {
      if (req.session && req.session.user && roles.includes(req.session.user.role)) {
        return next();
      }
      res.status(403).render('dashboard', { 
        user: req.session.user, 
        error: 'Access Denied: Unauthorized role attempt recorded.' 
      });
    };
  }
};