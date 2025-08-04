const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/supabase');
const { authenticateToken, requireOwnership, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get contestants for a category (public for active events)
router.get('/category/:categoryId', optionalAuth, async (req, res) => {
  try {
    const categoryId = req.params.categoryId;

    // First check if category and event exist and are accessible
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select(`
        *,
        event:events!event_id(status, organizer_id)
      `)
      .eq('id', categoryId)
      .single();

    if (categoryError || !category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check access permissions
    const isOwner = req.user && req.user.id === category.event.organizer_id;
    const isAdmin = req.user && req.user.role === 'admin';
    
    if (category.event.status !== 'active' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const { data: contestants, error } = await supabase
      .from('contestants')
      .select('*')
      .eq('category_id', categoryId)
      .order('display_order');

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch contestants', 
        message: error.message 
      });
    }

    res.json({ contestants });

  } catch (error) {
    console.error('Contestants fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch contestants' });
  }
});

// Get single contestant
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const contestantId = req.params.id;

    const { data: contestant, error } = await supabase
      .from('contestants')
      .select(`
        *,
        category:categories!category_id(
          *,
          event:events!event_id(status, organizer_id)
        )
      `)
      .eq('id', contestantId)
      .single();

    if (error || !contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    // Check access permissions
    const isOwner = req.user && req.user.id === contestant.category.event.organizer_id;
    const isAdmin = req.user && req.user.role === 'admin';
    
    if (contestant.category.event.status !== 'active' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    res.json({ contestant });

  } catch (error) {
    console.error('Contestant fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch contestant' });
  }
});

// Create new contestant
router.post('/', authenticateToken, [
  body('category_id').isUUID(),
  body('name').trim().isLength({ min: 2, max: 255 }),
  body('description').optional().trim(),
  body('image_url').optional().isURL(),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { category_id, name, description, image_url, display_order = 0 } = req.body;

    // Check if user owns the event through category
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select(`
        event_id,
        events!event_id(organizer_id, status)
      `)
      .eq('id', category_id)
      .single();

    if (categoryError || !category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (category.events.organizer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Don't allow adding contestants to active events with votes
    if (category.events.status === 'active') {
      // Check if event has votes
      const { data: votes, error: votesError } = await supabase
        .from('votes')
        .select('id')
        .eq('event_id', category.event_id)
        .limit(1);

      if (!votesError && votes && votes.length > 0) {
        return res.status(400).json({ 
          error: 'Cannot add contestants to active event with existing votes' 
        });
      }
    }

    const { data: contestant, error } = await supabase
      .from('contestants')
      .insert({
        category_id,
        name,
        description,
        image_url,
        display_order
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create contestant', 
        message: error.message 
      });
    }

    res.status(201).json({
      message: 'Contestant created successfully',
      contestant
    });

  } catch (error) {
    console.error('Contestant creation error:', error);
    res.status(500).json({ error: 'Failed to create contestant' });
  }
});

// Update contestant
router.put('/:id', authenticateToken, requireOwnership('contestant'), [
  body('name').optional().trim().isLength({ min: 2, max: 255 }),
  body('description').optional().trim(),
  body('image_url').optional().isURL(),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const contestantId = req.params.id;
    const { name, description, image_url, display_order } = req.body;

    // Check if contestant has votes (can't modify contestant with votes)
    const { data: contestantData, error: contestantError } = await supabase
      .from('contestants')
      .select('vote_count')
      .eq('id', contestantId)
      .single();

    if (contestantError || !contestantData) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    if (contestantData.vote_count > 0) {
      return res.status(400).json({ 
        error: 'Cannot modify contestant with existing votes' 
      });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (display_order !== undefined) updateData.display_order = display_order;
    updateData.updated_at = new Date().toISOString();

    const { data: contestant, error } = await supabase
      .from('contestants')
      .update(updateData)
      .eq('id', contestantId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update contestant', 
        message: error.message 
      });
    }

    res.json({
      message: 'Contestant updated successfully',
      contestant
    });

  } catch (error) {
    console.error('Contestant update error:', error);
    res.status(500).json({ error: 'Failed to update contestant' });
  }
});

// Delete contestant
router.delete('/:id', authenticateToken, requireOwnership('contestant'), async (req, res) => {
  try {
    const contestantId = req.params.id;

    // Check if contestant has votes
    const { data: contestant, error: contestantError } = await supabase
      .from('contestants')
      .select('vote_count')
      .eq('id', contestantId)
      .single();

    if (contestantError || !contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    if (contestant.vote_count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete contestant with existing votes' 
      });
    }

    const { error } = await supabase
      .from('contestants')
      .delete()
      .eq('id', contestantId);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to delete contestant', 
        message: error.message 
      });
    }

    res.json({ message: 'Contestant deleted successfully' });

  } catch (error) {
    console.error('Contestant deletion error:', error);
    res.status(500).json({ error: 'Failed to delete contestant' });
  }
});

// Reorder contestants within a category
router.post('/reorder', authenticateToken, [
  body('category_id').isUUID(),
  body('contestants').isArray(),
  body('contestants.*.id').isUUID(),
  body('contestants.*.display_order').isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { category_id, contestants } = req.body;

    // Check if user owns the event through category
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select(`
        events!event_id(organizer_id)
      `)
      .eq('id', category_id)
      .single();

    if (categoryError || !category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (category.events.organizer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update display orders
    const updates = contestants.map(contestant => 
      supabase
        .from('contestants')
        .update({ display_order: contestant.display_order })
        .eq('id', contestant.id)
        .eq('category_id', category_id)
    );

    const results = await Promise.all(updates);
    
    // Check for errors
    const hasErrors = results.some(result => result.error);
    if (hasErrors) {
      return res.status(400).json({ error: 'Failed to reorder contestants' });
    }

    res.json({ message: 'Contestants reordered successfully' });

  } catch (error) {
    console.error('Contestant reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder contestants' });
  }
});

// Get contestant voting statistics
router.get('/:id/stats', authenticateToken, requireOwnership('contestant'), async (req, res) => {
  try {
    const contestantId = req.params.id;

    const { data: contestant, error } = await supabase
      .from('contestants')
      .select(`
        id,
        name,
        vote_count,
        category:categories!category_id(
          id,
          name,
          event:events!event_id(
            id,
            title,
            vote_price
          )
        ),
        votes(
          id,
          amount,
          created_at,
          voter:users!voter_id(full_name, email)
        )
      `)
      .eq('id', contestantId)
      .single();

    if (error || !contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    // Calculate revenue
    const totalRevenue = contestant.votes.reduce((sum, vote) => 
      sum + parseFloat(vote.amount), 0);

    // Group votes by hour for chart data
    const votesByHour = {};
    contestant.votes.forEach(vote => {
      const hour = new Date(vote.created_at).toISOString().slice(0, 13) + ':00:00.000Z';
      votesByHour[hour] = (votesByHour[hour] || 0) + 1;
    });

    const chartData = Object.entries(votesByHour)
      .map(([hour, count]) => ({ hour, votes: count }))
      .sort((a, b) => new Date(a.hour) - new Date(b.hour));

    // Recent votes (without voter details for privacy)
    const recentVotes = contestant.votes
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10)
      .map(vote => ({
        id: vote.id,
        amount: vote.amount,
        created_at: vote.created_at
      }));

    res.json({
      contestant: {
        id: contestant.id,
        name: contestant.name,
        vote_count: contestant.vote_count,
        total_revenue: totalRevenue,
        category: contestant.category
      },
      chart_data: chartData,
      recent_votes: recentVotes
    });

  } catch (error) {
    console.error('Contestant stats error:', error);
    res.status(500).json({ error: 'Failed to fetch contestant statistics' });
  }
});

// Bulk create contestants
router.post('/bulk', authenticateToken, [
  body('category_id').isUUID(),
  body('contestants').isArray({ min: 1, max: 50 }),
  body('contestants.*.name').trim().isLength({ min: 2, max: 255 }),
  body('contestants.*.description').optional().trim(),
  body('contestants.*.image_url').optional().isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { category_id, contestants } = req.body;

    // Check if user owns the event through category
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select(`
        event_id,
        events!event_id(organizer_id, status)
      `)
      .eq('id', category_id)
      .single();

    if (categoryError || !category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (category.events.organizer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Don't allow adding contestants to active events with votes
    if (category.events.status === 'active') {
      const { data: votes, error: votesError } = await supabase
        .from('votes')
        .select('id')
        .eq('event_id', category.event_id)
        .limit(1);

      if (!votesError && votes && votes.length > 0) {
        return res.status(400).json({ 
          error: 'Cannot add contestants to active event with existing votes' 
        });
      }
    }

    // Prepare contestants data
    const contestantsData = contestants.map((contestant, index) => ({
      category_id,
      name: contestant.name,
      description: contestant.description || null,
      image_url: contestant.image_url || null,
      display_order: index
    }));

    const { data: createdContestants, error } = await supabase
      .from('contestants')
      .insert(contestantsData)
      .select();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create contestants', 
        message: error.message 
      });
    }

    res.status(201).json({
      message: `${createdContestants.length} contestants created successfully`,
      contestants: createdContestants
    });

  } catch (error) {
    console.error('Bulk contestant creation error:', error);
    res.status(500).json({ error: 'Failed to create contestants' });
  }
});

module.exports = router;