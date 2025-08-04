const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { supabase } = require('../config/supabase');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get votes for an event (public - aggregated data only)
router.get('/event/:eventId', optionalAuth, [
  query('category_id').optional().isUUID()
], async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const categoryId = req.query.category_id;

    // Check if event exists and is active
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('status, title, vote_price')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    // Build query for vote aggregation
    let query = supabase
      .from('votes')
      .select(`
        contestant_id,
        contestants!contestant_id(
          id,
          name,
          vote_count,
          category:categories!category_id(
            id,
            name
          )
        )
      `)
      .eq('event_id', eventId);

    if (categoryId) {
      query = query.eq('contestants.category_id', categoryId);
    }

    const { data: votes, error } = await query;

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch votes', 
        message: error.message 
      });
    }

    // Group votes by contestant and category
    const voteData = {};
    votes.forEach(vote => {
      const contestant = vote.contestants;
      const categoryName = contestant.category.name;
      
      if (!voteData[categoryName]) {
        voteData[categoryName] = [];
      }
      
      const existingContestant = voteData[categoryName].find(c => c.id === contestant.id);
      if (!existingContestant) {
        voteData[categoryName].push({
          id: contestant.id,
          name: contestant.name,
          vote_count: contestant.vote_count
        });
      }
    });

    // Sort contestants by vote count within each category
    Object.keys(voteData).forEach(category => {
      voteData[category].sort((a, b) => b.vote_count - a.vote_count);
    });

    res.json({
      event: {
        id: eventId,
        title: event.title,
        vote_price: event.vote_price
      },
      vote_data: voteData
    });

  } catch (error) {
    console.error('Event votes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch event votes' });
  }
});

// Get user's voting history
router.get('/my-votes', authenticateToken, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('event_id').optional().isUUID()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const eventId = req.query.event_id;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('votes')
      .select(`
        id,
        amount,
        created_at,
        contestant:contestants!contestant_id(
          id,
          name,
          category:categories!category_id(
            id,
            name,
            event:events!event_id(
              id,
              title,
              status
            )
          )
        )
      `)
      .eq('voter_id', userId)
      .order('created_at', { ascending: false });

    if (eventId) {
      query = query.eq('event_id', eventId);
    }

    const { data: votes, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch votes', 
        message: error.message 
      });
    }

    // Calculate total spent
    const totalSpent = votes.reduce((sum, vote) => sum + parseFloat(vote.amount), 0);

    res.json({
      votes,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      },
      summary: {
        total_votes: votes.length,
        total_spent: totalSpent
      }
    });

  } catch (error) {
    console.error('User votes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch user votes' });
  }
});

// Create a vote (this will be called after successful payment)
router.post('/', authenticateToken, [
  body('contestant_id').isUUID(),
  body('payment_id').isUUID(),
  body('amount').isFloat({ min: 0.01 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contestant_id, payment_id, amount } = req.body;
    const voterId = req.user.id;

    // Get contestant and event details
    const { data: contestant, error: contestantError } = await supabase
      .from('contestants')
      .select(`
        id,
        category:categories!category_id(
          event:events!event_id(
            id,
            status,
            vote_price,
            start_date,
            end_date
          )
        )
      `)
      .eq('id', contestant_id)
      .single();

    if (contestantError || !contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    const event = contestant.category.event;

    // Validate event is active and within voting period
    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    const now = new Date();
    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);

    if (now < startDate) {
      return res.status(400).json({ error: 'Voting has not started yet' });
    }

    if (now > endDate) {
      return res.status(400).json({ error: 'Voting has ended' });
    }

    // Validate amount matches event vote price
    if (parseFloat(amount) !== parseFloat(event.vote_price)) {
      return res.status(400).json({ 
        error: 'Invalid vote amount',
        expected: event.vote_price,
        received: amount
      });
    }

    // Check if payment exists and is completed
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('status, contestant_id, voter_id')
      .eq('id', payment_id)
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status !== 'completed') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    if (payment.contestant_id !== contestant_id || payment.voter_id !== voterId) {
      return res.status(400).json({ error: 'Payment mismatch' });
    }

    // Check if vote already exists for this payment
    const { data: existingVote, error: voteCheckError } = await supabase
      .from('votes')
      .select('id')
      .eq('payment_id', payment_id)
      .single();

    if (!voteCheckError && existingVote) {
      return res.status(400).json({ error: 'Vote already exists for this payment' });
    }

    // Create the vote
    const { data: vote, error } = await supabase
      .from('votes')
      .insert({
        voter_id: voterId,
        contestant_id,
        event_id: event.id,
        payment_id,
        amount
      })
      .select(`
        id,
        amount,
        created_at,
        contestant:contestants!contestant_id(
          id,
          name,
          vote_count,
          category:categories!category_id(
            id,
            name,
            event:events!event_id(
              id,
              title
            )
          )
        )
      `)
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create vote', 
        message: error.message 
      });
    }

    res.status(201).json({
      message: 'Vote cast successfully',
      vote
    });

  } catch (error) {
    console.error('Vote creation error:', error);
    res.status(500).json({ error: 'Failed to cast vote' });
  }
});

// Get vote statistics for a contestant (public)
router.get('/contestant/:contestantId/stats', async (req, res) => {
  try {
    const contestantId = req.params.contestantId;

    // Get contestant with basic info
    const { data: contestant, error: contestantError } = await supabase
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
            status,
            total_votes
          )
        )
      `)
      .eq('id', contestantId)
      .single();

    if (contestantError || !contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    // Only show stats for active events
    if (contestant.category.event.status !== 'active') {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    // Calculate percentage of total votes
    const totalEventVotes = contestant.category.event.total_votes;
    const votePercentage = totalEventVotes > 0 
      ? (contestant.vote_count / totalEventVotes * 100).toFixed(2)
      : 0;

    res.json({
      contestant: {
        id: contestant.id,
        name: contestant.name,
        vote_count: contestant.vote_count,
        vote_percentage: votePercentage,
        category: {
          id: contestant.category.id,
          name: contestant.category.name
        },
        event: {
          id: contestant.category.event.id,
          title: contestant.category.event.title,
          total_votes: totalEventVotes
        }
      }
    });

  } catch (error) {
    console.error('Contestant stats error:', error);
    res.status(500).json({ error: 'Failed to fetch contestant statistics' });
  }
});

// Get real-time vote feed for an event (public)
router.get('/event/:eventId/feed', [
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const limit = parseInt(req.query.limit) || 10;

    // Check if event is active
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('status')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    // Get recent votes (anonymized)
    const { data: votes, error } = await supabase
      .from('votes')
      .select(`
        id,
        amount,
        created_at,
        contestant:contestants!contestant_id(
          name,
          category:categories!category_id(name)
        )
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch vote feed', 
        message: error.message 
      });
    }

    // Format votes for public display
    const voteFeed = votes.map(vote => ({
      id: vote.id,
      amount: vote.amount,
      created_at: vote.created_at,
      contestant_name: vote.contestant.name,
      category_name: vote.contestant.category.name,
      voter_name: 'Anonymous' // Keep voters anonymous in public feed
    }));

    res.json({
      votes: voteFeed
    });

  } catch (error) {
    console.error('Vote feed error:', error);
    res.status(500).json({ error: 'Failed to fetch vote feed' });
  }
});

// Get leaderboard for an event
router.get('/event/:eventId/leaderboard', [
  query('category_id').optional().isUUID(),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res) => {
  try {
    const eventId = req.params.eventId;
    const categoryId = req.query.category_id;
    const limit = parseInt(req.query.limit) || 10;

    // Check if event is active
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('status, title')
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    // Build query for contestants
    let query = supabase
      .from('contestants')
      .select(`
        id,
        name,
        vote_count,
        category:categories!category_id(
          id,
          name
        )
      `)
      .eq('categories.event_id', eventId)
      .order('vote_count', { ascending: false });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data: contestants, error } = await query.limit(limit);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch leaderboard', 
        message: error.message 
      });
    }

    // Add rankings
    const leaderboard = contestants.map((contestant, index) => ({
      ...contestant,
      rank: index + 1
    }));

    res.json({
      event: {
        id: eventId,
        title: event.title
      },
      leaderboard
    });

  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Check if user can vote for a contestant
router.get('/can-vote/:contestantId', authenticateToken, async (req, res) => {
  try {
    const contestantId = req.params.contestantId;
    const userId = req.user.id;

    // Get contestant and event details
    const { data: contestant, error: contestantError } = await supabase
      .from('contestants')
      .select(`
        id,
        name,
        category:categories!category_id(
          event:events!event_id(
            id,
            status,
            vote_price,
            start_date,
            end_date
          )
        )
      `)
      .eq('id', contestantId)
      .single();

    if (contestantError || !contestant) {
      return res.status(404).json({ error: 'Contestant not found' });
    }

    const event = contestant.category.event;
    const now = new Date();
    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);

    let canVote = true;
    let reason = '';

    if (event.status !== 'active') {
      canVote = false;
      reason = 'Event is not active';
    } else if (now < startDate) {
      canVote = false;
      reason = 'Voting has not started yet';
    } else if (now > endDate) {
      canVote = false;
      reason = 'Voting has ended';
    }

    res.json({
      can_vote: canVote,
      reason: reason || 'You can vote for this contestant',
      event: {
        id: event.id,
        status: event.status,
        vote_price: event.vote_price,
        start_date: event.start_date,
        end_date: event.end_date
      },
      contestant: {
        id: contestant.id,
        name: contestant.name
      }
    });

  } catch (error) {
    console.error('Vote eligibility check error:', error);
    res.status(500).json({ error: 'Failed to check vote eligibility' });
  }
});

module.exports = router;