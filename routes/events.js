const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { supabase } = require('../config/supabase');
const { authenticateToken, requireApprovedOrganizer, requireOwnership, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all active events (public)
router.get('/', [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().trim()
], optionalAuth, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
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
      .eq('status', 'active')
      .gte('end_date', new Date().toISOString())
      .order('start_date', { ascending: true });

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
    console.error('Events fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get event by ID (public)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const eventId = req.params.id;

    const { data: event, error } = await supabase
      .from('events')
      .select(`
        *,
        organizer:users!organizer_id(full_name, email),
        categories(
          *,
          contestants(*)
        )
      `)
      .eq('id', eventId)
      .single();

    if (error || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if event is accessible
    const isOwner = req.user && req.user.id === event.organizer_id;
    const isAdmin = req.user && req.user.role === 'admin';
    
    if (event.status !== 'active' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event });

  } catch (error) {
    console.error('Event fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Get organizer's events
router.get('/organizer/my-events', authenticateToken, requireApprovedOrganizer, [
  query('status').optional().isIn(['draft', 'active', 'ended']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const organizerId = req.user.id;
    const status = req.query.status;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('events')
      .select(`
        *,
        categories(count),
        _count_votes:votes(count)
      `)
      .eq('organizer_id', organizerId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
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
    console.error('Organizer events fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create new event
router.post('/', authenticateToken, requireApprovedOrganizer, [
  body('title').trim().isLength({ min: 3, max: 255 }),
  body('description').optional().trim(),
  body('vote_price').isFloat({ min: 0.01 }),
  body('start_date').isISO8601(),
  body('end_date').isISO8601(),
  body('banner_image_url').optional().isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, vote_price, start_date, end_date, banner_image_url } = req.body;
    const organizerId = req.user.id;

    // Validate dates
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    const now = new Date();

    if (startDate <= now) {
      return res.status(400).json({ error: 'Start date must be in the future' });
    }

    if (endDate <= startDate) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const { data: event, error } = await supabase
      .from('events')
      .insert({
        organizer_id: organizerId,
        title,
        description,
        vote_price,
        start_date,
        end_date,
        banner_image_url,
        status: 'draft'
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create event', 
        message: error.message 
      });
    }

    res.status(201).json({
      message: 'Event created successfully',
      event
    });

  } catch (error) {
    console.error('Event creation error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event
router.put('/:id', authenticateToken, requireOwnership('event'), [
  body('title').optional().trim().isLength({ min: 3, max: 255 }),
  body('description').optional().trim(),
  body('vote_price').optional().isFloat({ min: 0.01 }),
  body('start_date').optional().isISO8601(),
  body('end_date').optional().isISO8601(),
  body('banner_image_url').optional().isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const eventId = req.params.id;
    const { title, description, vote_price, start_date, end_date, banner_image_url } = req.body;

    // Get current event to check status
    const { data: currentEvent, error: fetchError } = await supabase
      .from('events')
      .select('status, total_votes')
      .eq('id', eventId)
      .single();

    if (fetchError || !currentEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Don't allow changes to active events with votes
    if (currentEvent.status === 'active' && currentEvent.total_votes > 0) {
      return res.status(400).json({ 
        error: 'Cannot modify active event with existing votes' 
      });
    }

    const updateData = {};
    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (vote_price) updateData.vote_price = vote_price;
    if (start_date) updateData.start_date = start_date;
    if (end_date) updateData.end_date = end_date;
    if (banner_image_url !== undefined) updateData.banner_image_url = banner_image_url;

    // Validate dates if provided
    if (start_date || end_date) {
      const startDate = new Date(start_date || currentEvent.start_date);
      const endDate = new Date(end_date || currentEvent.end_date);

      if (endDate <= startDate) {
        return res.status(400).json({ error: 'End date must be after start date' });
      }
    }

    updateData.updated_at = new Date().toISOString();

    const { data: event, error } = await supabase
      .from('events')
      .update(updateData)
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update event', 
        message: error.message 
      });
    }

    res.json({
      message: 'Event updated successfully',
      event
    });

  } catch (error) {
    console.error('Event update error:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Activate event
router.post('/:id/activate', authenticateToken, requireOwnership('event'), async (req, res) => {
  try {
    const eventId = req.params.id;

    // Check if event can be activated
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select(`
        *,
        categories(
          id,
          contestants(count)
        )
      `)
      .eq('id', eventId)
      .single();

    if (fetchError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'draft') {
      return res.status(400).json({ error: 'Only draft events can be activated' });
    }

    // Validate event has categories and contestants
    if (!event.categories || event.categories.length === 0) {
      return res.status(400).json({ 
        error: 'Event must have at least one category to be activated' 
      });
    }

    const hasContestants = event.categories.some(category => 
      category.contestants && category.contestants.length > 0
    );

    if (!hasContestants) {
      return res.status(400).json({ 
        error: 'Event must have contestants in at least one category to be activated' 
      });
    }

    // Check dates
    const now = new Date();
    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);

    if (endDate <= now) {
      return res.status(400).json({ error: 'Event end date has already passed' });
    }

    const { data: updatedEvent, error } = await supabase
      .from('events')
      .update({ 
        status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to activate event', 
        message: error.message 
      });
    }

    res.json({
      message: 'Event activated successfully',
      event: updatedEvent
    });

  } catch (error) {
    console.error('Event activation error:', error);
    res.status(500).json({ error: 'Failed to activate event' });
  }
});

// End event
router.post('/:id/end', authenticateToken, requireOwnership('event'), async (req, res) => {
  try {
    const eventId = req.params.id;

    const { data: event, error } = await supabase
      .from('events')
      .update({ 
        status: 'ended',
        updated_at: new Date().toISOString()
      })
      .eq('id', eventId)
      .eq('status', 'active')
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to end event', 
        message: error.message 
      });
    }

    if (!event) {
      return res.status(404).json({ error: 'Active event not found' });
    }

    res.json({
      message: 'Event ended successfully',
      event
    });

  } catch (error) {
    console.error('Event end error:', error);
    res.status(500).json({ error: 'Failed to end event' });
  }
});

// Delete event
router.delete('/:id', authenticateToken, requireOwnership('event'), async (req, res) => {
  try {
    const eventId = req.params.id;

    // Check if event can be deleted
    const { data: event, error: fetchError } = await supabase
      .from('events')
      .select('status, total_votes')
      .eq('id', eventId)
      .single();

    if (fetchError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status === 'active' && event.total_votes > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete active event with existing votes' 
      });
    }

    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', eventId);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to delete event', 
        message: error.message 
      });
    }

    res.json({ message: 'Event deleted successfully' });

  } catch (error) {
    console.error('Event deletion error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get event statistics
router.get('/:id/stats', authenticateToken, requireOwnership('event'), async (req, res) => {
  try {
    const eventId = req.params.id;

    // Get event with detailed stats
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        id,
        title,
        status,
        total_votes,
        total_revenue,
        vote_price,
        start_date,
        end_date,
        created_at
      `)
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Get category stats
    const { data: categoryStats, error: categoryError } = await supabase
      .from('categories')
      .select(`
        id,
        name,
        contestants(
          id,
          name,
          vote_count
        )
      `)
      .eq('event_id', eventId)
      .order('display_order');

    if (categoryError) {
      return res.status(400).json({ 
        error: 'Failed to fetch category stats', 
        message: categoryError.message 
      });
    }

    // Get recent votes
    const { data: recentVotes, error: votesError } = await supabase
      .from('votes')
      .select(`
        id,
        amount,
        created_at,
        voter:users!voter_id(full_name),
        contestant:contestants!contestant_id(name)
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (votesError) {
      return res.status(400).json({ 
        error: 'Failed to fetch recent votes', 
        message: votesError.message 
      });
    }

    // Calculate platform commission
    const commissionRate = 0.05; // 5% - should come from platform settings
    const platformFee = event.total_revenue * commissionRate;
    const organizerEarnings = event.total_revenue - platformFee;

    res.json({
      event: {
        ...event,
        platform_fee: platformFee,
        organizer_earnings: organizerEarnings
      },
      categories: categoryStats,
      recent_votes: recentVotes
    });

  } catch (error) {
    console.error('Event stats error:', error);
    res.status(500).json({ error: 'Failed to fetch event statistics' });
  }
});

module.exports = router;