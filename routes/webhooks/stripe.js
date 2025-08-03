const express = require('express');
const { supabase } = require('../../config/supabase');
const { constructWebhookEvent } = require('../../config/stripe');

const router = express.Router();

// Stripe webhook endpoint
router.post('/', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!signature || !endpointSecret) {
    return res.status(400).json({ error: 'Missing webhook signature or secret' });
  }

  try {
    // Construct webhook event
    const webhookResult = constructWebhookEvent(req.body, signature, endpointSecret);
    
    if (!webhookResult.success) {
      console.error('Webhook signature verification failed:', webhookResult.error);
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    const event = webhookResult.event;
    console.log('Stripe webhook received:', event.type);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
      
      case 'payment_intent.canceled':
        await handlePaymentCanceled(event.data.object);
        break;
      
      case 'charge.dispute.created':
        await handleChargeDispute(event.data.object);
        break;
      
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle successful payment
async function handlePaymentSucceeded(paymentIntent) {
  try {
    const paymentId = paymentIntent.metadata.payment_id;
    
    if (!paymentId) {
      console.error('No payment_id in Stripe metadata');
      return;
    }

    // Get payment record
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_intent_id', paymentIntent.id)
      .single();

    if (paymentError || !payment) {
      console.error('Payment not found for Stripe payment intent:', paymentIntent.id);
      return;
    }

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        payment_provider_id: paymentIntent.id,
        metadata: {
          ...payment.metadata,
          stripe_payment_intent: paymentIntent
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error('Failed to update payment status:', updateError);
      return;
    }

    // Create vote record
    const { error: voteError } = await supabase
      .from('votes')
      .insert({
        voter_id: payment.voter_id,
        contestant_id: payment.contestant_id,
        event_id: payment.event_id,
        payment_id: payment.id,
        amount: payment.amount
      });

    if (voteError) {
      console.error('Failed to create vote record:', voteError);
      // Don't fail the webhook, but log the error
      // The vote can be created manually or through a retry mechanism
    }

    console.log('Payment processed successfully:', payment.id);

  } catch (error) {
    console.error('Error handling payment success:', error);
  }
}

// Handle failed payment
async function handlePaymentFailed(paymentIntent) {
  try {
    const paymentId = paymentIntent.metadata.payment_id;
    
    if (!paymentId) {
      console.error('No payment_id in Stripe metadata');
      return;
    }

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        payment_provider_id: paymentIntent.id,
        metadata: {
          stripe_payment_intent: paymentIntent,
          failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed'
        },
        updated_at: new Date().toISOString()
      })
      .eq('payment_intent_id', paymentIntent.id);

    if (updateError) {
      console.error('Failed to update payment status:', updateError);
    }

    console.log('Payment failed:', paymentIntent.id);

  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

// Handle canceled payment
async function handlePaymentCanceled(paymentIntent) {
  try {
    const paymentId = paymentIntent.metadata.payment_id;
    
    if (!paymentId) {
      console.error('No payment_id in Stripe metadata');
      return;
    }

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        payment_provider_id: paymentIntent.id,
        metadata: {
          stripe_payment_intent: paymentIntent,
          cancellation_reason: paymentIntent.cancellation_reason || 'Payment canceled'
        },
        updated_at: new Date().toISOString()
      })
      .eq('payment_intent_id', paymentIntent.id);

    if (updateError) {
      console.error('Failed to update payment status:', updateError);
    }

    console.log('Payment canceled:', paymentIntent.id);

  } catch (error) {
    console.error('Error handling payment cancellation:', error);
  }
}

// Handle charge disputes (chargebacks)
async function handleChargeDispute(dispute) {
  try {
    const paymentIntentId = dispute.payment_intent;
    
    if (!paymentIntentId) {
      console.error('No payment_intent in dispute object');
      return;
    }

    // Find payment by payment intent ID
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_intent_id', paymentIntentId)
      .single();

    if (paymentError || !payment) {
      console.error('Payment not found for disputed charge:', paymentIntentId);
      return;
    }

    // Update payment status to disputed
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'disputed',
        metadata: {
          ...payment.metadata,
          dispute: dispute,
          dispute_reason: dispute.reason
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error('Failed to update payment status for dispute:', updateError);
    }

    // Optionally, you could also update the vote status or take other actions
    // For now, we'll just log the dispute
    console.log('Payment disputed:', payment.id, 'Reason:', dispute.reason);

  } catch (error) {
    console.error('Error handling charge dispute:', error);
  }
}

module.exports = router;