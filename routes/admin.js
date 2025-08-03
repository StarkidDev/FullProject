const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { supabase, supabaseAdmin } = require('../config/supabase');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// All admin routes require admin role
router.use(authenticateToken);
router.use(requireRole('admin'));

// Get platform dashboard overview
router.get('/dashboard', async (req, res) => {
  try {
    // Get counts for different entities
    const [
      usersResult,
      organizersResult,
      eventsResult,
      paymentsResult,
      votesResult
    ] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'organizer'),
      supabase.from('events').select('id', { count: 'exact', head: true }),
      supabase.from('payments').select('amount, platform_fee, status'),
      supabase.from('votes').select('id', { count: 'exact', head: true })
    ]);

    // Calculate revenue metrics
    const payments = paymentsResult.data || [];
    const completedPayments = payments.filter(p => p.status === 'completed');
    
    const totalRevenue = completedPayments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const platformRevenue = completedPayments.reduce((sum, p) => sum + parseFloat(p.platform_fee), 0);
    const organizerRevenue = totalRevenue - platformRevenue;

    // Get recent activity
    const { data: recentEvents } = await supabase
      .from('events')
      .select('id, title, status, created_at, organizer:users!organizer_id(full_name)')
      .order('created_at', { ascending: false })
      .limit(5);

    const { data: recentPayments } = await supabase
      .from('payments')
      .select('id, amount, status, created_at, voter:users!voter_id(full_name)')
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({
      stats: {
        total_users: usersResult.count || 0,
        total_organizers: organizersResult.count || 0,
        total_events: eventsResult.count || 0,
        total_payments: payments.length,
        total_votes: votesResult.count || 0,
        total_revenue: totalRevenue,
        platform_revenue: platformRevenue,
        organizer_revenue: organizerRevenue
      },
      recent_activity: {
        events: recentEvents,
        payments: recentPayments
      }
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get all users with filtering and pagination
router.get('/users', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('role').optional().isIn(['admin', 'organizer', 'voter']),
  query('status').optional().isIn(['pending', 'approved', 'blocked']),
  query('search').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const role = req.query.role;
    const status = req.query.status;
    const search = req.query.search;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (role) {
      query = query.eq('role', role);
    }

    if (status) {
      query = query.eq('organizer_status', status);
    }

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: users, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch users', 
        message: error.message 
      });
    }

    res.json({
      users,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('Admin users fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Update user role or status
router.put('/users/:userId', [
  body('role').optional().isIn(['admin', 'organizer', 'voter']),
  body('organizer_status').optional().isIn(['pending', 'approved', 'blocked'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.params.userId;
    const { role, organizer_status } = req.body;

    // Don't allow admin to modify their own role
    if (userId === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot modify your own admin role' });
    }

    const updateData = {};
    if (role) updateData.role = role;
    if (organizer_status) updateData.organizer_status = organizer_status;
    updateData.updated_at = new Date().toISOString();

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update user', 
        message: error.message 
      });
    }

    res.json({
      message: 'User updated successfully',
      user
    });

  } catch (error) {
    console.error('Admin user update error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Get platform settings
router.get('/settings', async (req, res) => {
  try {
    const { data: settings, error } = await supabase
      .from('platform_settings')
      .select('*')
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch platform settings', 
        message: error.message 
      });
    }

    res.json({ settings });

  } catch (error) {
    console.error('Admin settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch platform settings' });
  }
});

// Update platform settings
router.put('/settings', [
  body('commission_rate').optional().isFloat({ min: 0, max: 1 }),
  body('stripe_enabled').optional().isBoolean(),
  body('paystack_enabled').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { commission_rate, stripe_enabled, paystack_enabled } = req.body;

    const updateData = {};
    if (commission_rate !== undefined) updateData.commission_rate = commission_rate;
    if (stripe_enabled !== undefined) updateData.stripe_enabled = stripe_enabled;
    if (paystack_enabled !== undefined) updateData.paystack_enabled = paystack_enabled;
    updateData.updated_by = req.user.id;
    updateData.updated_at = new Date().toISOString();

    const { data: settings, error } = await supabase
      .from('platform_settings')
      .update(updateData)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update platform settings', 
        message: error.message 
      });
    }

    res.json({
      message: 'Platform settings updated successfully',
      settings
    });

  } catch (error) {
    console.error('Admin settings update error:', error);
    res.status(500).json({ error: 'Failed to update platform settings' });
  }
});

// Get all events with filtering
router.get('/events', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['draft', 'active', 'ended']),
  query('search').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const search = req.query.search;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('events')
      .select(`
        *,
        organizer:users!organizer_id(full_name, email),
        categories(count),
        _count_votes:votes(count)
      `)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data: events, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch events', 
        message: error.message 
      });
    }

    res.json({
      events,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('Admin events fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Force end an event
router.post('/events/:eventId/force-end', async (req, res) => {
  try {
    const eventId = req.params.eventId;

    const { data: event, error } = await supabase
      .from('events')
      .update({ 
        status: 'ended',
        updated_at: new Date().toISOString()
      })
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to end event', 
        message: error.message 
      });
    }

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({
      message: 'Event ended successfully',
      event
    });

  } catch (error) {
    console.error('Admin event end error:', error);
    res.status(500).json({ error: 'Failed to end event' });
  }
});

// Get payment analytics
router.get('/payments/analytics', [
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601(),
  query('payment_method').optional().isIn(['stripe', 'paystack'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { start_date, end_date, payment_method } = req.query;

    let query = supabase
      .from('payments')
      .select('*');

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    if (payment_method) {
      query = query.eq('payment_method', payment_method);
    }

    const { data: payments, error } = await query;

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch payment analytics', 
        message: error.message 
      });
    }

    // Group payments by status
    const statusGroups = payments.reduce((acc, payment) => {
      const status = payment.status;
      if (!acc[status]) {
        acc[status] = { count: 0, amount: 0, platform_fee: 0 };
      }
      acc[status].count++;
      acc[status].amount += parseFloat(payment.amount);
      acc[status].platform_fee += parseFloat(payment.platform_fee);
      return acc;
    }, {});

    // Group payments by payment method
    const methodGroups = payments.reduce((acc, payment) => {
      const method = payment.payment_method;
      if (!acc[method]) {
        acc[method] = { count: 0, amount: 0 };
      }
      acc[method].count++;
      if (payment.status === 'completed') {
        acc[method].amount += parseFloat(payment.amount);
      }
      return acc;
    }, {});

    // Group payments by date (daily)
    const dailyGroups = payments.reduce((acc, payment) => {
      const date = payment.created_at.split('T')[0];
      if (!acc[date]) {
        acc[date] = { count: 0, amount: 0, completed: 0 };
      }
      acc[date].count++;
      if (payment.status === 'completed') {
        acc[date].amount += parseFloat(payment.amount);
        acc[date].completed++;
      }
      return acc;
    }, {});

    res.json({
      summary: {
        total_payments: payments.length,
        total_amount: payments.reduce((sum, p) => sum + (p.status === 'completed' ? parseFloat(p.amount) : 0), 0),
        total_platform_fees: payments.reduce((sum, p) => sum + (p.status === 'completed' ? parseFloat(p.platform_fee) : 0), 0)
      },
      by_status: statusGroups,
      by_method: methodGroups,
      by_date: Object.entries(dailyGroups)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date))
    });

  } catch (error) {
    console.error('Admin payment analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch payment analytics' });
  }
});

// Get organizer earnings and withdrawal requests
router.get('/withdrawals', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'processing', 'completed', 'failed'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('withdrawals')
      .select(`
        *,
        organizer:users!organizer_id(full_name, email)
      `)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: withdrawals, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch withdrawals', 
        message: error.message 
      });
    }

    res.json({
      withdrawals,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('Admin withdrawals fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// Process withdrawal request
router.post('/withdrawals/:withdrawalId/process', [
  body('status').isIn(['processing', 'completed', 'failed']),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const withdrawalId = req.params.withdrawalId;
    const { status, notes } = req.body;

    const updateData = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'completed') {
      updateData.processed_at = new Date().toISOString();
    }

    if (notes) {
      updateData.payment_details = {
        admin_notes: notes,
        processed_by: req.user.id
      };
    }

    const { data: withdrawal, error } = await supabase
      .from('withdrawals')
      .update(updateData)
      .eq('id', withdrawalId)
      .select(`
        *,
        organizer:users!organizer_id(full_name, email)
      `)
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to process withdrawal', 
        message: error.message 
      });
    }

    res.json({
      message: 'Withdrawal processed successfully',
      withdrawal
    });

  } catch (error) {
    console.error('Admin withdrawal process error:', error);
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

// Delete user (soft delete by blocking)
router.delete('/users/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;

    // Don't allow admin to delete themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Instead of deleting, we'll block the user
    const { data: user, error } = await supabase
      .from('users')
      .update({
        organizer_status: 'blocked',
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to block user', 
        message: error.message 
      });
    }

    res.json({
      message: 'User blocked successfully',
      user
    });

  } catch (error) {
    console.error('Admin user delete error:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Get system health and metrics
router.get('/system/health', async (req, res) => {
  try {
    // Get database connection status
    const { data: dbTest, error: dbError } = await supabase
      .from('platform_settings')
      .select('id')
      .limit(1);

    // Get some basic metrics
    const [
      activeEventsResult,
      pendingPaymentsResult,
      todayVotesResult
    ] = await Promise.all([
      supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('votes').select('id', { count: 'exact', head: true }).gte('created_at', new Date().toISOString().split('T')[0])
    ]);

    res.json({
      status: 'healthy',
      database: {
        connected: !dbError,
        error: dbError?.message
      },
      metrics: {
        active_events: activeEventsResult.count || 0,
        pending_payments: pendingPaymentsResult.count || 0,
        votes_today: todayVotesResult.count || 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('System health check error:', error);
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;