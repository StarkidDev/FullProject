const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Get Stripe publishable key for frontend
const getPublishableKey = () => {
  return process.env.STRIPE_PUBLISHABLE_KEY;
};

// Create payment intent for voting
const createPaymentIntent = async ({ amount, currency = 'usd', metadata = {} }) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata
    });

    return {
      success: true,
      paymentIntent
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Confirm payment intent
const confirmPaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      success: true,
      paymentIntent
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Retrieve payment intent
const retrievePaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return {
      success: true,
      paymentIntent
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Create customer
const createCustomer = async ({ email, name, metadata = {} }) => {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata
    });

    return {
      success: true,
      customer
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Create refund
const createRefund = async ({ paymentIntentId, amount, reason = 'requested_by_customer' }) => {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined, // Convert to cents if specified
      reason
    });

    return {
      success: true,
      refund
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Construct webhook event
const constructWebhookEvent = (payload, signature, endpointSecret) => {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, endpointSecret);
    return {
      success: true,
      event
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
};

// Get supported currencies
const getSupportedCurrencies = () => {
  return ['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy', 'sgd', 'chf', 'nok', 'sek', 'dkk'];
};

// Convert amount to minor currency unit (cents)
const toMinorCurrencyUnit = (amount, currency = 'usd') => {
  const zeroDecimalCurrencies = ['jpy', 'krw', 'clp', 'vnd'];
  
  if (zeroDecimalCurrencies.includes(currency.toLowerCase())) {
    return Math.round(amount);
  }
  
  return Math.round(amount * 100);
};

// Convert amount from minor currency unit
const fromMinorCurrencyUnit = (amount, currency = 'usd') => {
  const zeroDecimalCurrencies = ['jpy', 'krw', 'clp', 'vnd'];
  
  if (zeroDecimalCurrencies.includes(currency.toLowerCase())) {
    return amount;
  }
  
  return amount / 100;
};

module.exports = {
  stripe,
  getPublishableKey,
  createPaymentIntent,
  confirmPaymentIntent,
  retrievePaymentIntent,
  createCustomer,
  createRefund,
  constructWebhookEvent,
  getSupportedCurrencies,
  toMinorCurrencyUnit,
  fromMinorCurrencyUnit
};