const LEARNER_PACKAGES_CONFIG_PATH = Object.freeze(['features', 'learner_packages_enabled']);
const FEATURE_DISABLED_CODE = 'LEARNER_PACKAGES_DISABLED';
const { catalogueEligibility } = require('./_full-curriculum');

function isLearnerPackagesEnabled(config) {
  return config?.features?.learner_packages_enabled === true;
}

function buildCatalogueEligibility(product, options = {}) {
  const result = catalogueEligibility(product, options);
  return {
    ...result,
    phase: options.purchasingEnabled === true ? 'full_curriculum_test_foundation' : 'catalogue_only',
    eligibility_determined: true,
    evidence: {
      source: 'full_curriculum_foundation',
      test_booking_status: options.testBookingStatus || 'missing',
      test_booking_future: options.testBookingFuture === true,
      active_enrolment: options.hasActiveEnrolment === true,
      consumer_rights_ready: options.consumerRightsReady === true,
      controlled_pilot_access: options.pilotAccessApproved === true,
    },
  };
}

module.exports = {
  LEARNER_PACKAGES_CONFIG_PATH,
  FEATURE_DISABLED_CODE,
  isLearnerPackagesEnabled,
  buildCatalogueEligibility,
};
