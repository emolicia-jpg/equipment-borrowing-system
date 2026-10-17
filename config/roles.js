// config/roles.js
// Role-based access, one role per stakeholder in the Stakeholder List.
// Access is defined by role and task only (Inclusive Requirement: Role-Based Access, NFR-4).

const PERMISSIONS = {
  // Primary
  student: [
    'equipment:view',          // FR-1
    'request:create',          // FR-2
    'request:view_own',        // FR-7
    'notification:view_own'    // FR-7
  ],
  faculty: [
    'equipment:view',
    'request:create',
    'request:view_own',
    'request:confirm_return',  // confirm return details
    'notification:view_own'
  ],
  custodian: [
    'equipment:view',
    'equipment:update_condition',
    'request:view_all',
    'request:deny',
    'request:release',         // FR-5
    'request:return',          // FR-6
    'notification:view_own'
  ],

  // Secondary
  coordinator: [
    'equipment:view',
    'request:view_all',        // monitor borrowing activity
    'request:deny',
    'request:return_for_correction',
    'report:view',
    'notification:view_own'
  ],
  property: [
    'equipment:view',
    'request:view_all',        // accountability records (read-only)
    'report:view',             // inventory-related reports (FR-8)
    'notification:view_own'
  ],

  // Decision-maker
  dean: [
    'equipment:view',
    'request:view_all',
    'report:view',             // utilization + accountability (FR-8)
    'notification:view_own'
  ],

  // Peripheral
  admin: [                     // IT / System Administrator
    'user:manage',             // accounts and access
    'equipment:view',
    'equipment:delete',
    'report:view',
    'system:backup',
    'notification:view_own'
  ],
  security: [                  // Campus Security (read-only)
    'equipment:view',
    'request:view_released',   // approved / borrowed items for after-hours release
    'notification:view_own'
  ]
};

function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission);
}

// Express middleware: router.post('/approve/:id', requirePermission('request:approve'), handler)
// Assumes the logged-in user is at req.session.user (adjust to match your middleware/auth.js).
function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) return res.redirect('/login');
    if (!can(user.role, permission)) {
      return res.status(403).send('You do not have permission to access this page.');
    }
    next();
  };
}

module.exports = { PERMISSIONS, can, requirePermission };