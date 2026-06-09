const CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES = Object.freeze(['klarna']);
const RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION_ENV = 'STRIPE_RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION';

function getReservedBlockBankCheckoutPaymentOptions(env = process.env) {
  const configurationId = String(env[RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION_ENV] || '').trim();
  if (!configurationId) {
    const err = new Error(`${RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION_ENV} is required for Reserved Weekly Slot bank checkout`);
    err.code = 'PAY_BY_BANK_CONFIGURATION_MISSING';
    throw err;
  }
  return { payment_method_configuration: configurationId };
}

module.exports = {
  CHECKOUT_EXCLUDED_PAYMENT_METHOD_TYPES,
  RESERVED_BLOCK_BANK_PAYMENT_METHOD_CONFIGURATION_ENV,
  getReservedBlockBankCheckoutPaymentOptions,
};
