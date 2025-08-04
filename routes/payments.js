const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const { createPaymentIntent, getPublishableKey } = require('../config/stripe');
const axios = require('axios');

const router = express.Router();

// Get platform settings (commission rate, payment methods)
router.get('/settings', async (req, res) => {
  try {
    const { data: settings, error } = await supabase
      .from('platform_settings')
      .select('commission_rate, stripe_enabled, paystack_enabled')
      .single();

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch platform settings', 
        message: error.message 
      });
    }

    res.json({
      commission_rate: settings.commission_rate,
      stripe_enabled: settings.stripe_enabled,
      paystack_enabled: settings.paystack_enabled,
      stripe_publishable_key: settings.stripe_enabled ? getPublishableKey() : null,
      paystack_public_key: settings.paystack_enabled ? process.env.PAYSTACK_PUBLIC_KEY : null
    });

  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch payment settings' });
  }
});

// Create payment intent for Stripe
router.post('/stripe/create-intent', authenticateToken, [
  body('contestant_id').isUUID(),
  body('amount').isFloat({ min: 0.01 }),
  body('currency').optional().isIn(['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy', 'sgd', 'chf', 'nok', 'sek', 'dkk'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contestant_id, amount, currency = 'usd' } = req.body;
    const userId = req.user.id;

    // Get contestant and event details
    const { data: contestant, error: contestantError } = await supabase
      .from('contestants')
      .select(`
        id,
        name,
        category:categories!category_id(
          id,
          name,
          event:events!event_id(
            id,
            title,
            status,
            vote_price,
            organizer_id,
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

    // Get platform settings for commission calculation
    const { data: settings, error: settingsError } = await supabase
      .from('platform_settings')
      .select('commission_rate')
      .single();

    if (settingsError) {
      return res.status(400).json({ error: 'Failed to fetch platform settings' });
    }

    const platformFee = amount * settings.commission_rate;
    const organizerEarnings = amount - platformFee;

    // Create payment record
    const paymentId = uuidv4();
    
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        id: paymentId,
        voter_id: userId,
        event_id: event.id,
        contestant_id,
        amount,
        platform_fee: platformFee,
        organizer_earnings: organizerEarnings,
        payment_method: 'stripe',
        status: 'pending'
      })
      .select()
      .single();

    if (paymentError) {
      return res.status(400).json({ 
        error: 'Failed to create payment record', 
        message: paymentError.message 
      });
    }

    // Create Stripe payment intent
    const stripeResult = await createPaymentIntent({
      amount,
      currency,
      metadata: {
        payment_id: paymentId,
        voter_id: userId,
        contestant_id,
        event_id: event.id,
        contestant_name: contestant.name,
        event_title: event.title
      }
    });

    if (!stripeResult.success) {
      // Update payment status to failed
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('id', paymentId);

      return res.status(400).json({ 
        error: 'Failed to create payment intent', 
        message: stripeResult.error 
      });
    }

    // Update payment with Stripe payment intent ID
    await supabase
      .from('payments')
      .update({ 
        payment_intent_id: stripeResult.paymentIntent.id,
        metadata: { stripe_payment_intent: stripeResult.paymentIntent }
      })
      .eq('id', paymentId);

    res.json({
      payment_id: paymentId,
      client_secret: stripeResult.paymentIntent.client_secret,
      amount,
      currency,
      contestant: {
        id: contestant.id,
        name: contestant.name
      },
      event: {
        id: event.id,
        title: event.title
      }
    });

  } catch (error) {
    console.error('Stripe payment intent creation error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Initialize Paystack payment
router.post('/paystack/initialize', authenticateToken, [
  body('contestant_id').isUUID(),
  body('amount').isFloat({ min: 0.01 }),
  body('mobile_money_network').optional().isIn(['mtn', 'airtel', 'vodafone'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { contestant_id, amount, mobile_money_network } = req.body;
    const userId = req.user.id;

    // Get contestant and event details (same validation as Stripe)
    const { data: contestant, error: contestantError } = await supabase
      .from('contestants')
      .select(`
        id,
        name,
        category:categories!category_id(
          id,
          name,
          event:events!event_id(
            id,
            title,
            status,
            vote_price,
            organizer_id,
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

    // Validate event and voting period (same as Stripe)
    if (event.status !== 'active') {
      return res.status(400).json({ error: 'Event is not active' });
    }

    const now = new Date();
    const startDate = new Date(event.start_date);
    const endDate = new Date(event.end_date);

    if (now < startDate || now > endDate) {
      return res.status(400).json({ error: 'Voting period has ended or not started' });
    }

    if (parseFloat(amount) !== parseFloat(event.vote_price)) {
      return res.status(400).json({ 
        error: 'Invalid vote amount',
        expected: event.vote_price,
        received: amount
      });
    }

    // Get platform settings
    const { data: settings, error: settingsError } = await supabase
      .from('platform_settings')
      .select('commission_rate')
      .single();

    if (settingsError) {
      return res.status(400).json({ error: 'Failed to fetch platform settings' });
    }

    const platformFee = amount * settings.commission_rate;
    const organizerEarnings = amount - platformFee;

    // Create payment record
    const paymentId = uuidv4();
    
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        id: paymentId,
        voter_id: userId,
        event_id: event.id,
        contestant_id,
        amount,
        platform_fee: platformFee,
        organizer_earnings: organizerEarnings,
        payment_method: 'paystack',
        status: 'pending'
      })
      .select()
      .single();

    if (paymentError) {
      return res.status(400).json({ 
        error: 'Failed to create payment record', 
        message: paymentError.message 
      });
    }

    // Initialize Paystack payment
    const paystackData = {
      email: req.user.email,
      amount: Math.round(amount * 100), // Convert to kobo (Ghanaian pesewas)
      currency: 'GHS',
      reference: paymentId,
      callback_url: `${process.env.FRONTEND_URL}/payment/success`,
      metadata: {
        payment_id: paymentId,
        voter_id: userId,
        contestant_id,
        event_id: event.id,
        contestant_name: contestant.name,
        event_title: event.title,
        mobile_money_network
      },
      channels: mobile_money_network ? ['mobile_money'] : ['card', 'mobile_money']
    };

    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      paystackData,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!paystackResponse.data.status) {
      // Update payment status to failed
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('id', paymentId);

      return res.status(400).json({ 
        error: 'Failed to initialize Paystack payment', 
        message: paystackResponse.data.message 
      });
    }

    // Update payment with Paystack reference
    await supabase
      .from('payments')
      .update({ 
        payment_provider_id: paystackResponse.data.data.reference,
        metadata: { paystack_response: paystackResponse.data.data }
      })
      .eq('id', paymentId);

    res.json({
      payment_id: paymentId,
      authorization_url: paystackResponse.data.data.authorization_url,
      access_code: paystackResponse.data.data.access_code,
      reference: paystackResponse.data.data.reference,
      amount,
      contestant: {
        id: contestant.id,
        name: contestant.name
      },
      event: {
        id: event.id,
        title: event.title
      }
    });

  } catch (error) {
    console.error('Paystack payment initialization error:', error);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
});

// Verify payment status
router.get('/verify/:paymentId', authenticateToken, async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    const userId = req.user.id;

    // Get payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select(`
        *,
        contestant:contestants!contestant_id(name),
        event:events!event_id(title)
      `)
      .eq('id', paymentId)
      .eq('voter_id', userId)
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    let verificationResult = { verified: false, status: payment.status };

    // Verify with payment provider if still pending
    if (payment.status === 'pending') {
      if (payment.payment_method === 'stripe' && payment.payment_intent_id) {
        // Verify with Stripe
        const { retrievePaymentIntent } = require('../config/stripe');
        const stripeResult = await retrievePaymentIntent(payment.payment_intent_id);
        
        if (stripeResult.success) {
          const status = stripeResult.paymentIntent.status;
          if (status === 'succeeded') {
            verificationResult = { verified: true, status: 'completed' };
          } else if (status === 'canceled' || status === 'payment_failed') {
            verificationResult = { verified: true, status: 'failed' };
          }
        }
      } else if (payment.payment_method === 'paystack' && payment.payment_provider_id) {
        // Verify with Paystack
        try {
          const paystackResponse = await axios.get(
            `https://api.paystack.co/transaction/verify/${payment.payment_provider_id}`,
            {
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
              }
            }
          );

          if (paystackResponse.data.status && paystackResponse.data.data.status === 'success') {
            verificationResult = { verified: true, status: 'completed' };
          } else if (paystackResponse.data.data.status === 'failed' || paystackResponse.data.data.status === 'abandoned') {
            verificationResult = { verified: true, status: 'failed' };
          }
        } catch (paystackError) {
          console.error('Paystack verification error:', paystackError);
        }
      }

      // Update payment status if verification result differs
      if (verificationResult.verified && verificationResult.status !== payment.status) {
        await supabase
          .from('payments')
          .update({ 
            status: verificationResult.status,
            updated_at: new Date().toISOString()
          })
          .eq('id', paymentId);
        
        payment.status = verificationResult.status;
      }
    }

    res.json({
      payment: {
        id: payment.id,
        amount: payment.amount,
        status: payment.status,
        payment_method: payment.payment_method,
        created_at: payment.created_at,
        contestant: payment.contestant,
        event: payment.event
      },
      verified: verificationResult.verified || payment.status === 'completed'
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Get user's payment history
router.get('/history', authenticateToken, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('status').optional().isIn(['pending', 'completed', 'failed', 'refunded'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('payments')
      .select(`
        id,
        amount,
        platform_fee,
        status,
        payment_method,
        created_at,
        contestant:contestants!contestant_id(id, name),
        event:events!event_id(id, title)
      `)
      .eq('voter_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: payments, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch payment history', 
        message: error.message 
      });
    }

    // Calculate summary
    const totalSpent = payments.reduce((sum, payment) => 
      payment.status === 'completed' ? sum + parseFloat(payment.amount) : sum, 0);
    
    const totalFees = payments.reduce((sum, payment) => 
      payment.status === 'completed' ? sum + parseFloat(payment.platform_fee) : sum, 0);

    res.json({
      payments,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit)
      },
      summary: {
        total_payments: payments.length,
        total_spent: totalSpent,
        total_fees: totalFees
      }
    });

  } catch (error) {
    console.error('Payment history fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// Cancel pending payment
router.post('/cancel/:paymentId', authenticateToken, async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    const userId = req.user.id;

    // Get payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('voter_id', userId)
      .eq('status', 'pending')
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({ error: 'Pending payment not found' });
    }

    // Cancel with payment provider if necessary
    if (payment.payment_method === 'stripe' && payment.payment_intent_id) {
      const { stripe } = require('../config/stripe');
      try {
        await stripe.paymentIntents.cancel(payment.payment_intent_id);
      } catch (stripeError) {
        console.error('Stripe cancellation error:', stripeError);
        // Continue with local cancellation even if Stripe fails
      }
    }

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({ 
        status: 'failed',
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId);

    if (updateError) {
      return res.status(400).json({ 
        error: 'Failed to cancel payment', 
        message: updateError.message 
      });
    }

    res.json({ message: 'Payment cancelled successfully' });

  } catch (error) {
    console.error('Payment cancellation error:', error);
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

module.exports = router;