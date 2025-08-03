const express = require('express');
const crypto = require('crypto');
const { supabase } = require('../../config/supabase');
const axios = require('axios');

const router = express.Router();

// Paystack webhook endpoint
router.post('/', async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-paystack-signature'];
    const secret = process.env.PAYSTACK_SECRET_KEY;
    
    if (!signature || !secret) {
      return res.status(400).json({ error: 'Missing webhook signature or secret' });
    }

    const hash = crypto.createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      console.error('Paystack webhook signature verification failed');
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    const event = req.body;
    console.log('Paystack webhook received:', event.event);

    switch (event.event) {
      case 'charge.success':
        await handleChargeSuccess(event.data);
        break;
      
      case 'charge.failed':
        await handleChargeFailed(event.data);
        break;
      
      case 'transfer.success':
        await handleTransferSuccess(event.data);
        break;
      
      case 'transfer.failed':
        await handleTransferFailed(event.data);
        break;

      default:
        console.log(`Unhandled Paystack event type: ${event.event}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Paystack webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Handle successful charge
async function handleChargeSuccess(charge) {
  try {
    const reference = charge.reference;
    
    if (!reference) {
      console.error('No reference in Paystack charge data');
      return;
    }

    // Verify the transaction with Paystack API
    const verificationResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    if (!verificationResponse.data.status || verificationResponse.data.data.status !== 'success') {
      console.error('Paystack verification failed for reference:', reference);
      return;
    }

    // Get payment record using reference as payment ID
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('id', reference)
      .single();

    if (paymentError || !payment) {
      console.error('Payment not found for Paystack reference:', reference);
      return;
    }

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        payment_provider_id: charge.id,
        metadata: {
          ...payment.metadata,
          paystack_charge: charge,
          paystack_verification: verificationResponse.data.data
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
    }

    console.log('Paystack payment processed successfully:', payment.id);

  } catch (error) {
    console.error('Error handling Paystack charge success:', error);
  }
}

// Handle failed charge
async function handleChargeFailed(charge) {
  try {
    const reference = charge.reference;
    
    if (!reference) {
      console.error('No reference in Paystack charge data');
      return;
    }

    // Update payment status
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        status: 'failed',
        payment_provider_id: charge.id,
        metadata: {
          paystack_charge: charge,
          failure_reason: charge.gateway_response || 'Payment failed'
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', reference);

    if (updateError) {
      console.error('Failed to update payment status:', updateError);
    }

    console.log('Paystack payment failed:', reference);

  } catch (error) {
    console.error('Error handling Paystack charge failure:', error);
  }
}

// Handle successful transfer (for organizer payouts)
async function handleTransferSuccess(transfer) {
  try {
    const reference = transfer.reference;
    
    if (!reference) {
      console.error('No reference in Paystack transfer data');
      return;
    }

    // Update withdrawal status if this is a withdrawal transfer
    const { error: updateError } = await supabase
      .from('withdrawals')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        payment_details: {
          ...transfer,
          paystack_transfer_id: transfer.id
        }
      })
      .eq('id', reference);

    if (updateError) {
      console.error('Failed to update withdrawal status:', updateError);
    } else {
      console.log('Paystack transfer completed successfully:', reference);
    }

  } catch (error) {
    console.error('Error handling Paystack transfer success:', error);
  }
}

// Handle failed transfer
async function handleTransferFailed(transfer) {
  try {
    const reference = transfer.reference;
    
    if (!reference) {
      console.error('No reference in Paystack transfer data');
      return;
    }

    // Update withdrawal status
    const { error: updateError } = await supabase
      .from('withdrawals')
      .update({
        status: 'failed',
        payment_details: {
          ...transfer,
          failure_reason: transfer.reason || 'Transfer failed'
        }
      })
      .eq('id', reference);

    if (updateError) {
      console.error('Failed to update withdrawal status:', updateError);
    } else {
      console.log('Paystack transfer failed:', reference);
    }

  } catch (error) {
    console.error('Error handling Paystack transfer failure:', error);
  }
}

module.exports = router;