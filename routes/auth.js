const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase, supabaseAdmin } = require('../config/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Register new user
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('full_name').trim().isLength({ min: 2 }),
  body('role').optional().isIn(['organizer', 'voter'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, full_name, phone, role = 'voter' } = req.body;

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: {
        full_name,
        role
      },
      email_confirm: true // Auto-confirm for development
    });

    if (authError) {
      return res.status(400).json({ 
        error: 'Registration failed', 
        message: authError.message 
      });
    }

    // Update user profile in our users table
    const { data: profileData, error: profileError } = await supabase
      .from('users')
      .update({
        full_name,
        phone,
        role,
        organizer_status: role === 'organizer' ? 'pending' : null
      })
      .eq('id', authData.user.id)
      .select()
      .single();

    if (profileError) {
      console.error('Profile update error:', profileError);
      // Don't fail registration if profile update fails
    }

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: authData.user.id,
        email: authData.user.email,
        full_name,
        role,
        organizer_status: role === 'organizer' ? 'pending' : null
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Sign in with Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      return res.status(401).json({ 
        error: 'Login failed', 
        message: authError.message 
      });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError) {
      return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({
      message: 'Login successful',
      user: {
        ...authData.user,
        ...profile
      },
      session: authData.session
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token
    });

    if (error) {
      return res.status(401).json({ 
        error: 'Token refresh failed', 
        message: error.message 
      });
    }

    res.json({
      message: 'Token refreshed successfully',
      session: data.session
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Logout user
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return res.status(400).json({ 
        error: 'Logout failed', 
        message: error.message 
      });
    }

    res.json({ message: 'Logout successful' });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.json({
      user: req.user
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/me', authenticateToken, [
  body('full_name').optional().trim().isLength({ min: 2 }),
  body('phone').optional().isMobilePhone()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { full_name, phone } = req.body;
    const userId = req.user.id;

    const updateData = {};
    if (full_name) updateData.full_name = full_name;
    if (phone) updateData.phone = phone;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Profile update failed', 
        message: error.message 
      });
    }

    res.json({
      message: 'Profile updated successfully',
      user: data
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

// Request organizer role
router.post('/request-organizer', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is already an organizer
    if (req.user.role === 'organizer') {
      return res.status(400).json({ 
        error: 'User is already an organizer',
        status: req.user.organizer_status
      });
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        role: 'organizer',
        organizer_status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Organizer request failed', 
        message: error.message 
      });
    }

    res.json({
      message: 'Organizer request submitted successfully',
      user: data
    });

  } catch (error) {
    console.error('Organizer request error:', error);
    res.status(500).json({ error: 'Organizer request failed' });
  }
});

// Change password
router.post('/change-password', authenticateToken, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { current_password, new_password } = req.body;

    // Verify current password by trying to sign in
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: current_password
    });

    if (verifyError) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: new_password
    });

    if (updateError) {
      return res.status(400).json({ 
        error: 'Password update failed', 
        message: updateError.message 
      });
    }

    res.json({ message: 'Password updated successfully' });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Password change failed' });
  }
});

// Forgot password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`
    });

    if (error) {
      return res.status(400).json({ 
        error: 'Password reset failed', 
        message: error.message 
      });
    }

    res.json({ 
      message: 'Password reset instructions sent to your email' 
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// Reset password
router.post('/reset-password', [
  body('access_token').notEmpty(),
  body('refresh_token').notEmpty(),
  body('new_password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { access_token, refresh_token, new_password } = req.body;

    // Set session with reset tokens
    const { error: sessionError } = await supabase.auth.setSession({
      access_token,
      refresh_token
    });

    if (sessionError) {
      return res.status(400).json({ 
        error: 'Invalid reset tokens', 
        message: sessionError.message 
      });
    }

    // Update password
    const { error: updateError } = await supabase.auth.updateUser({
      password: new_password
    });

    if (updateError) {
      return res.status(400).json({ 
        error: 'Password reset failed', 
        message: updateError.message 
      });
    }

    res.json({ message: 'Password reset successfully' });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

module.exports = router;