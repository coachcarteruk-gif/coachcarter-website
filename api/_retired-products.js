const RETIREMENT_CONFIG_PATH = Object.freeze(['features', 'retire_incompatible_products']);
const RETIRED_PRODUCT_CODE = 'PRODUCT_CREATION_RETIRED';

const RETIRED_PRODUCT_MESSAGES = Object.freeze({
  repeated_booking: 'New repeated lesson bookings are retired. Book one lesson at a time instead.',
  reserved_weekly_slot: 'New Reserved Weekly Slots are retired. Existing reserved lessons can still be managed.',
  flexible_offer: 'New flexible lesson offers are retired. Send an offer for one specific lesson instead.',
  repeated_offer: 'New repeated lesson offers are retired. Send an offer for one specific lesson instead.',
});

function isRetirementEnabled(config) {
  return config?.features?.retire_incompatible_products === true;
}

function validateSchoolId(schoolId) {
  const parsed = Number(schoolId);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError('schoolId must be a positive safe integer');
  }
  return parsed;
}

async function loadRetiredProductState(sql, schoolId) {
  if (typeof sql !== 'function') {
    throw new TypeError('sql must be a Neon-compatible tagged query function');
  }
  const scopedSchoolId = validateSchoolId(schoolId);
  const rows = await sql`
    SELECT config
      FROM schools
     WHERE id = ${scopedSchoolId}
     LIMIT 1
  `;
  return isRetirementEnabled(rows[0]?.config);
}

function retiredProductPayload(product) {
  const message = RETIRED_PRODUCT_MESSAGES[product];
  if (!message) throw new TypeError(`Unknown retired product: ${product}`);
  return {
    error: true,
    code: RETIRED_PRODUCT_CODE,
    retired_product: product,
    message,
  };
}

function sendRetiredProduct(res, product) {
  return res.status(410).json(retiredProductPayload(product));
}

module.exports = {
  RETIREMENT_CONFIG_PATH,
  RETIRED_PRODUCT_CODE,
  isRetirementEnabled,
  loadRetiredProductState,
  retiredProductPayload,
  sendRetiredProduct,
};
