const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');
const { authenticateToken, requireApprovedOrganizer } = require('../middleware/auth');

const router = express.Router();

// All organizer routes require approved organizer role
router.use(authenticateToken);
router.use(requireApprovedOrganizer);

// Get organizer dashboard overview
router.get('/dashboard', async (req, res) => {
  try {
    const organizerId = req.user.id;

    // Get organizer's events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select(`
        id,
        title,
        status,
        total_votes,
        total_revenue,
        created_at,
        categories(count)
      `)
      .eq('organizer_id', organizerId)
      .order('created_at', { ascending: false });

    if (eventsError) {
      return res.status(400).json({ 
        error: 'Failed to fetch events', 
        message: eventsError.message 
      });
    }

    // Get total earnings
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('organizer_earnings, status')
      .eq('voter_id', organizerId)
      .eq('status', 'completed');

    if (paymentsError) {
      return res.status(400).json({ 
        error: 'Failed to fetch payments', 
        message: paymentsError.message 
      });
    }

    // Calculate metrics
    const totalEvents = events.length;
    const activeEvents = events.filter(e => e.status === 'active').length;
    const totalVotes = events.reduce((sum, e) => sum + (e.total_votes || 0), 0);
    const totalRevenue = events.reduce((sum, e) => sum + parseFloat(e.total_revenue || 0), 0);

    // Get platform commission rate
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('commission_rate')
      .single();

    const commissionRate = settings?.commission_rate || 0.05;
    const platformFee = totalRevenue * commissionRate;
    const availableEarnings = totalRevenue - platformFee;

    // Get withdrawal history
    const { data: withdrawals, error: withdrawalsError } = await supabase
      .from('withdrawals')
      .select('amount, status')
      .eq('organizer_id', organizerId);

    const totalWithdrawn = withdrawals
      ?.filter(w => w.status === 'completed')
      .reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0;

    const pendingWithdrawals = withdrawals
      ?.filter(w => w.status === 'pending')
      .reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0;

    const withdrawableAmount = availableEarnings - totalWithdrawn - pendingWithdrawals;

    res.json({
      stats: {
        total_events: totalEvents,
        active_events: activeEvents,
        total_votes: totalVotes,
        total_revenue: totalRevenue,
        platform_fee: platformFee,
        available_earnings: availableEarnings,
        total_withdrawn: totalWithdrawn,
        pending_withdrawals: pendingWithdrawals,
        withdrawable_amount: Math.max(0, withdrawableAmount)
      },
      recent_events: events.slice(0, 5)
    });

  } catch (error) {
    console.error('Organizer dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Get detailed earnings breakdown
router.get('/earnings', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('event_id').optional().isUUID(),
  query('start_date').optional().isISO8601(),
  query('end_date').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const organizerId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const eventId = req.query.event_id;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    const offset = (page - 1) * limit;

    // Build query for payments
    let query = supabase
      .from('payments')
      .select(`
        id,
        amount,
        platform_fee,
        organizer_earnings,
        status,
        created_at,
        event:events!event_id(id, title),
        contestant:contestants!contestant_id(id, name)
      `)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });

    // Filter by organizer's events
    if (eventId) {
      // Verify organizer owns this event
      const { data: event } = await supabase
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('organizer_id', organizerId)
        .single();

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      query = query.eq('event_id', eventId);
    } else {
      // Get all events by this organizer
      const { data: organizerEvents } = await supabase
        .from('events')
        .select('id')
        .eq('organizer_id', organizerId);

      const eventIds = organizerEvents?.map(e => e.id) || [];
      if (eventIds.length === 0) {
        return res.json({
          earnings: [],
          pagination: { page, limit, total: 0, pages: 0 },
          summary: { total_earnings: 0, total_platform_fees: 0, total_payments: 0 }
        });
      }

      query = query.in('event_id', eventIds);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data: earnings, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch earnings', 
        message: error.message 
      });
    }

    // Calculate summary
    const totalEarnings = earnings.reduce((sum, e) => sum + parseFloat(e.organizer_earnings), 0);
    const totalPlatformFees = earnings.reduce((sum, e) => sum + parseFloat(e.platform_fee), 0);

    res.json({
      earnings,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      },
      summary: {
        total_earnings: totalEarnings,
        total_platform_fees: totalPlatformFees,
        total_payments: earnings.length
      }
    });

  } catch (error) {
    console.error('Organizer earnings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch earnings' });
  }
});

// Get withdrawal history
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

    const organizerId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('withdrawals')
      .select('*')
      .eq('organizer_id', organizerId)
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
    console.error('Organizer withdrawals fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// Request withdrawal
router.post('/withdrawals', [
  body('amount').isFloat({ min: 1 }),
  body('payment_method').isIn(['bank_transfer', 'mobile_money', 'paystack']),
  body('payment_details').isObject(),
  body('payment_details.account_number').optional().trim(),
  body('payment_details.bank_name').optional().trim(),
  body('payment_details.account_name').optional().trim(),
  body('payment_details.mobile_number').optional().trim(),
  body('payment_details.network').optional().isIn(['mtn', 'airtel', 'vodafone'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const organizerId = req.user.id;
    const { amount, payment_method, payment_details } = req.body;

    // Calculate available balance
    const { data: events } = await supabase
      .from('events')
      .select('total_revenue')
      .eq('organizer_id', organizerId);

    const totalRevenue = events?.reduce((sum, e) => sum + parseFloat(e.total_revenue || 0), 0) || 0;

    // Get platform commission rate
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('commission_rate')
      .single();

    const commissionRate = settings?.commission_rate || 0.05;
    const availableEarnings = totalRevenue * (1 - commissionRate);

    // Get total already withdrawn or pending
    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select('amount, status')
      .eq('organizer_id', organizerId)
      .in('status', ['completed', 'pending', 'processing']);

    const totalWithdrawnOrPending = withdrawals?.reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0;
    const withdrawableAmount = availableEarnings - totalWithdrawnOrPending;

    if (amount > withdrawableAmount) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: withdrawableAmount,
        requested: amount
      });
    }

    // Validate payment details based on method
    if (payment_method === 'bank_transfer') {
      if (!payment_details.account_number || !payment_details.bank_name || !payment_details.account_name) {
        return res.status(400).json({ 
          error: 'Bank transfer requires account_number, bank_name, and account_name' 
        });
      }
    } else if (payment_method === 'mobile_money') {
      if (!payment_details.mobile_number || !payment_details.network) {
        return res.status(400).json({ 
          error: 'Mobile money requires mobile_number and network' 
        });
      }
    }

    // Create withdrawal request
    const withdrawalId = uuidv4();
    
    const { data: withdrawal, error } = await supabase
      .from('withdrawals')
      .insert({
        id: withdrawalId,
        organizer_id: organizerId,
        amount,
        status: 'pending',
        payment_details: {
          method: payment_method,
          ...payment_details,
          requested_at: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create withdrawal request', 
        message: error.message 
      });
    }

    res.status(201).json({
      message: 'Withdrawal request submitted successfully',
      withdrawal
    });

  } catch (error) {
    console.error('Withdrawal request error:', error);
    res.status(500).json({ error: 'Failed to create withdrawal request' });
  }
});

// Cancel pending withdrawal
router.delete('/withdrawals/:withdrawalId', async (req, res) => {
  try {
    const withdrawalId = req.params.withdrawalId;
    const organizerId = req.user.id;

    // Check if withdrawal exists and is pending
    const { data: withdrawal, error: fetchError } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .eq('organizer_id', organizerId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !withdrawal) {
      return res.status(404).json({ error: 'Pending withdrawal not found' });
    }

    // Delete the withdrawal request
    const { error } = await supabase
      .from('withdrawals')
      .delete()
      .eq('id', withdrawalId);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to cancel withdrawal', 
        message: error.message 
      });
    }

    res.json({ message: 'Withdrawal request cancelled successfully' });

  } catch (error) {
    console.error('Withdrawal cancellation error:', error);
    res.status(500).json({ error: 'Failed to cancel withdrawal' });
  }
});

// Get earnings analytics
router.get('/analytics/earnings', [
  query('period').optional().isIn(['7d', '30d', '90d', '1y']),
  query('event_id').optional().isUUID()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const organizerId = req.user.id;
    const period = req.query.period || '30d';
    const eventId = req.query.event_id;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
    }

    // Build query
    let query = supabase
      .from('payments')
      .select(`
        amount,
        platform_fee,
        organizer_earnings,
        created_at,
        event:events!event_id(id, title)
      `)
      .eq('status', 'completed')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    // Filter by organizer's events
    if (eventId) {
      // Verify organizer owns this event
      const { data: event } = await supabase
        .from('events')
        .select('id')
        .eq('id', eventId)
        .eq('organizer_id', organizerId)
        .single();

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      query = query.eq('event_id', eventId);
    } else {
      // Get all events by this organizer
      const { data: organizerEvents } = await supabase
        .from('events')
        .select('id')
        .eq('organizer_id', organizerId);

      const eventIds = organizerEvents?.map(e => e.id) || [];
      if (eventIds.length > 0) {
        query = query.in('event_id', eventIds);
      }
    }

    const { data: payments, error } = await query;

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch analytics', 
        message: error.message 
      });
    }

    // Group by date
    const dailyEarnings = {};
    payments?.forEach(payment => {
      const date = payment.created_at.split('T')[0];
      if (!dailyEarnings[date]) {
        dailyEarnings[date] = {
          date,
          earnings: 0,
          revenue: 0,
          platform_fees: 0,
          vote_count: 0
        };
      }
      dailyEarnings[date].earnings += parseFloat(payment.organizer_earnings);
      dailyEarnings[date].revenue += parseFloat(payment.amount);
      dailyEarnings[date].platform_fees += parseFloat(payment.platform_fee);
      dailyEarnings[date].vote_count++;
    });

    const chartData = Object.values(dailyEarnings).sort((a, b) => a.date.localeCompare(b.date));

    // Calculate totals
    const totalEarnings = payments?.reduce((sum, p) => sum + parseFloat(p.organizer_earnings), 0) || 0;
    const totalRevenue = payments?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;
    const totalPlatformFees = payments?.reduce((sum, p) => sum + parseFloat(p.platform_fee), 0) || 0;

    res.json({
      summary: {
        period,
        total_earnings: totalEarnings,
        total_revenue: totalRevenue,
        total_platform_fees: totalPlatformFees,
        total_votes: payments?.length || 0
      },
      chart_data: chartData
    });

  } catch (error) {
    console.error('Earnings analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch earnings analytics' });
  }
});

// Get withdrawal limits and fees
router.get('/withdrawal-info', async (req, res) => {
  try {
    const organizerId = req.user.id;

    // Calculate available balance
    const { data: events } = await supabase
      .from('events')
      .select('total_revenue')
      .eq('organizer_id', organizerId);

    const totalRevenue = events?.reduce((sum, e) => sum + parseFloat(e.total_revenue || 0), 0) || 0;

    // Get platform settings
    const { data: settings } = await supabase
      .from('platform_settings')
      .select('commission_rate')
      .single();

    const commissionRate = settings?.commission_rate || 0.05;
    const availableEarnings = totalRevenue * (1 - commissionRate);

    // Get total already withdrawn or pending
    const { data: withdrawals } = await supabase
      .from('withdrawals')
      .select('amount, status')
      .eq('organizer_id', organizerId)
      .in('status', ['completed', 'pending', 'processing']);

    const totalWithdrawnOrPending = withdrawals?.reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0;
    const withdrawableAmount = Math.max(0, availableEarnings - totalWithdrawnOrPending);

    res.json({
      available_balance: withdrawableAmount,
      total_earnings: availableEarnings,
      total_withdrawn: withdrawals?.filter(w => w.status === 'completed').reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0,
      pending_withdrawals: withdrawals?.filter(w => ['pending', 'processing'].includes(w.status)).reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0,
      minimum_withdrawal: 10, // Minimum withdrawal amount
      withdrawal_methods: [
        {
          method: 'bank_transfer',
          name: 'Bank Transfer',
          fee: 0,
          processing_time: '1-3 business days',
          required_fields: ['account_number', 'bank_name', 'account_name']
        },
        {
          method: 'mobile_money',
          name: 'Mobile Money',
          fee: 0.01, // 1% fee
          processing_time: 'Instant',
          required_fields: ['mobile_number', 'network'],
          supported_networks: ['mtn', 'airtel', 'vodafone']
        }
      ]
    });

  } catch (error) {
    console.error('Withdrawal info error:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawal information' });
  }
});

module.exports = router;