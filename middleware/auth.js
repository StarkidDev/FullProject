const { supabase } = require('../config/supabase');

// Middleware to verify JWT token and extract user
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get user profile with role information
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    req.user = {
      ...user,
      ...profile
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Middleware to check user roles
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
};

// Middleware to check organizer approval status
const requireApprovedOrganizer = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Organizer role required' });
  }

  if (req.user.organizer_status !== 'approved') {
    return res.status(403).json({ 
      error: 'Organizer approval required',
      status: req.user.organizer_status
    });
  }

  next();
};

// Middleware to check if user owns the resource
const requireOwnership = (resourceType) => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params.id || req.params.eventId;
      const userId = req.user.id;

      let query;
      switch (resourceType) {
        case 'event':
          query = supabase
            .from('events')
            .select('organizer_id')
            .eq('id', resourceId)
            .single();
          break;
        case 'category':
          query = supabase
            .from('categories')
            .select('event_id, events!inner(organizer_id)')
            .eq('id', resourceId)
            .single();
          break;
        case 'contestant':
          query = supabase
            .from('contestants')
            .select('category_id, categories!inner(event_id, events!inner(organizer_id))')
            .eq('id', resourceId)
            .single();
          break;
        default:
          return res.status(400).json({ error: 'Invalid resource type' });
      }

      const { data, error } = await query;

      if (error || !data) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Check ownership based on resource type
      let ownerId;
      switch (resourceType) {
        case 'event':
          ownerId = data.organizer_id;
          break;
        case 'category':
          ownerId = data.events.organizer_id;
          break;
        case 'contestant':
          ownerId = data.categories.events.organizer_id;
          break;
      }

      if (ownerId !== userId && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Resource access denied' });
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (!error && user) {
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', user.id)
          .single();

        if (profile) {
          req.user = { ...user, ...profile };
        }
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    next();
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requireApprovedOrganizer,
  requireOwnership,
  optionalAuth
};