export const RBAC_ACTIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  MANAGE: 'manage'
};

export const RBAC_RESOURCES = {
  USERS: 'users',
  COURSES: 'courses',
  ANALYTICS: 'analytics'
};

export const ROLE_PERMISSIONS = {
  admin: {
    users: { view: true, edit: true, manage: true },
    courses: { view: true, edit: true, manage: true },
    analytics: { view: true, edit: true, manage: true }
  },
  teacher: {
    users: { view: true, edit: false, manage: false },
    courses: { view: true, edit: true, manage: false },
    analytics: { view: true, edit: false, manage: false }
  },
  student: {
    users: { view: false, edit: false, manage: false },
    courses: { view: true, edit: false, manage: false },
    analytics: { view: false, edit: false, manage: false }
  }
};

export const hasPermission = (role, resource, action) => {
  if (!role || !resource || !action) {
    return false;
  }

  return !!ROLE_PERMISSIONS?.[role]?.[resource]?.[action];
};

export const permissionMiddleware = (resource, action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    if (!hasPermission(req.user.role, resource, action)) {
      return res.status(403).json({
        success: false,
        message: `Insufficient permission: ${resource}.${action}`
      });
    }

    next();
  };
};
