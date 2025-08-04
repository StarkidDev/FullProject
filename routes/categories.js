const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/supabase');
const { authenticateToken, requireOwnership, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get categories for an event (public for active events)
router.get('/event/:eventId', optionalAuth, async (req, res) => {
  try {
    const eventId = req.params.eventId;

    // First check if event exists and is accessible
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('status, organizer_id')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check access permissions
    const isOwner = req.user && req.user.id === event.organizer_id;
    const isAdmin = req.user && req.user.role === 'admin';
    
    if (event.status !== 'active' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const { data: categories, error } = await supabase
      .from('categories')
      .select(`
        *,
        contestants(*)
      `)
      .eq('event_id', eventId)
      .order('display_order');

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch categories', 
        message: error.message 
      });
    }

    res.json({ categories });

  } catch (error) {
    console.error('Categories fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get single category
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const categoryId = req.params.id;

    const { data: category, error } = await supabase
      .from('categories')
      .select(`
        *,
        event:events!event_id(status, organizer_id),
        contestants(*)
      `)
      .eq('id', categoryId)
      .single();

    if (error || !category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check access permissions
    const isOwner = req.user && req.user.id === category.event.organizer_id;
    const isAdmin = req.user && req.user.role === 'admin';
    
    if (category.event.status !== 'active' && !isOwner && !isAdmin) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ category });

  } catch (error) {
    console.error('Category fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

// Create new category
router.post('/', authenticateToken, [
  body('event_id').isUUID(),
  body('name').trim().isLength({ min: 2, max: 255 }),
  body('description').optional().trim(),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { event_id, name, description, display_order = 0 } = req.body;

    // Check if user owns the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('organizer_id, status')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.organizer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Don't allow adding categories to active events with votes
    if (event.status === 'active') {
      // Check if event has votes
      const { data: votes, error: votesError } = await supabase
        .from('votes')
        .select('id')
        .eq('event_id', event_id)
        .limit(1);

      if (!votesError && votes && votes.length > 0) {
        return res.status(400).json({ 
          error: 'Cannot add categories to active event with existing votes' 
        });
      }
    }

    const { data: category, error } = await supabase
      .from('categories')
      .insert({
        event_id,
        name,
        description,
        display_order
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create category', 
        message: error.message 
      });
    }

    res.status(201).json({
      message: 'Category created successfully',
      category
    });

  } catch (error) {
    console.error('Category creation error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category
router.put('/:id', authenticateToken, requireOwnership('category'), [
  body('name').optional().trim().isLength({ min: 2, max: 255 }),
  body('description').optional().trim(),
  body('display_order').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const categoryId = req.params.id;
    const { name, description, display_order } = req.body;

    // Check if category's event is active with votes
    const { data: categoryData, error: categoryError } = await supabase
      .from('categories')
      .select(`
        event_id,
        events!event_id(status),
        contestants!category_id(vote_count)
      `)
      .eq('id', categoryId)
      .single();

    if (categoryError || !categoryData) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const hasVotes = categoryData.contestants.some(contestant => contestant.vote_count > 0);
    
    if (categoryData.events.status === 'active' && hasVotes) {
      return res.status(400).json({ 
        error: 'Cannot modify category with existing votes' 
      });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (display_order !== undefined) updateData.display_order = display_order;

    const { data: category, error } = await supabase
      .from('categories')
      .update(updateData)
      .eq('id', categoryId)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update category', 
        message: error.message 
      });
    }

    res.json({
      message: 'Category updated successfully',
      category
    });

  } catch (error) {
    console.error('Category update error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', authenticateToken, requireOwnership('category'), async (req, res) => {
  try {
    const categoryId = req.params.id;

    // Check if category has contestants with votes
    const { data: contestants, error: contestantsError } = await supabase
      .from('contestants')
      .select('vote_count')
      .eq('category_id', categoryId);

    if (contestantsError) {
      return res.status(400).json({ 
        error: 'Failed to check category status', 
        message: contestantsError.message 
      });
    }

    const hasVotes = contestants && contestants.some(contestant => contestant.vote_count > 0);
    
    if (hasVotes) {
      return res.status(400).json({ 
        error: 'Cannot delete category with contestants that have votes' 
      });
    }

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to delete category', 
        message: error.message 
      });
    }

    res.json({ message: 'Category deleted successfully' });

  } catch (error) {
    console.error('Category deletion error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Reorder categories
router.post('/reorder', authenticateToken, [
  body('event_id').isUUID(),
  body('categories').isArray(),
  body('categories.*.id').isUUID(),
  body('categories.*.display_order').isInt({ min: 0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { event_id, categories } = req.body;

    // Check if user owns the event
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('organizer_id')
      .eq('id', event_id)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.organizer_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update display orders
    const updates = categories.map(category => 
      supabase
        .from('categories')
        .update({ display_order: category.display_order })
        .eq('id', category.id)
        .eq('event_id', event_id)
    );

    const results = await Promise.all(updates);
    
    // Check for errors
    const hasErrors = results.some(result => result.error);
    if (hasErrors) {
      return res.status(400).json({ error: 'Failed to reorder categories' });
    }

    res.json({ message: 'Categories reordered successfully' });

  } catch (error) {
    console.error('Category reorder error:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

// Get category statistics
router.get('/:id/stats', authenticateToken, requireOwnership('category'), async (req, res) => {
  try {
    const categoryId = req.params.id;

    const { data: category, error } = await supabase
      .from('categories')
      .select(`
        id,
        name,
        event_id,
        contestants(
          id,
          name,
          vote_count,
          votes(
            id,
            amount,
            created_at,
            voter:users!voter_id(full_name)
          )
        )
      `)
      .eq('id', categoryId)
      .single();

    if (error || !category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Calculate stats
    const totalVotes = category.contestants.reduce((sum, contestant) => 
      sum + contestant.vote_count, 0);
    
    const totalRevenue = category.contestants.reduce((sum, contestant) => 
      sum + contestant.votes.reduce((voteSum, vote) => voteSum + parseFloat(vote.amount), 0), 0);

    // Sort contestants by vote count
    const sortedContestants = category.contestants
      .map(contestant => ({
        ...contestant,
        votes: undefined, // Remove detailed votes from response
        vote_percentage: totalVotes > 0 ? (contestant.vote_count / totalVotes * 100).toFixed(2) : 0
      }))
      .sort((a, b) => b.vote_count - a.vote_count);

    res.json({
      category: {
        id: category.id,
        name: category.name,
        event_id: category.event_id,
        total_votes: totalVotes,
        total_revenue: totalRevenue
      },
      contestants: sortedContestants
    });

  } catch (error) {
    console.error('Category stats error:', error);
    res.status(500).json({ error: 'Failed to fetch category statistics' });
  }
});

module.exports = router;