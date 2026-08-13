const LEARNER_PACKAGES_CONFIG_PATH = Object.freeze(['features', 'learner_packages_enabled']);
const FEATURE_DISABLED_CODE = 'LEARNER_PACKAGES_DISABLED';

function isLearnerPackagesEnabled(config) {
  return config?.features?.learner_packages_enabled === true;
}

function buildCatalogueEligibility(product) {
  const checkoutUnavailable = {
    purchase_eligible: false,
    checkout_available: false,
    phase: 'catalogue_only',
  };

  if (product.prerequisite_product_id) {
    const prerequisiteName = product.prerequisite_name || 'the previous phase';
    return {
      ...checkoutUnavailable,
      state: 'locked',
      eligibility_determined: true,
      reason: `Requires an independently assessed pass for ${prerequisiteName}. No package assessment evidence is available in Phase 1.`,
      evidence: {
        source: 'catalogue_prerequisite_only',
        assessment_records_available: false,
        prerequisite_product_id: product.prerequisite_product_id,
        prerequisite_slug: product.prerequisite_slug || null,
      },
    };
  }

  return {
    ...checkoutUnavailable,
    state: 'available_to_compare',
    eligibility_determined: false,
    reason: 'No catalogue prerequisite blocks comparison. Purchase eligibility is not evaluated until the later enrolment and payment phases exist.',
    evidence: {
      source: 'catalogue_only',
      assessment_records_available: false,
      enrolment_records_available: false,
    },
  };
}

module.exports = {
  LEARNER_PACKAGES_CONFIG_PATH,
  FEATURE_DISABLED_CODE,
  isLearnerPackagesEnabled,
  buildCatalogueEligibility,
};
