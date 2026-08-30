'use strict';

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanIdentifier(value, maxLength) {
  var cleaned = cleanText(value, maxLength);
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(cleaned) ? cleaned : '';
}

function normalizeEnquiryAttribution(body) {
  var source = body && typeof body === 'object' ? body : {};
  return {
    experiment_key: cleanIdentifier(source.experiment_key, 100),
    experiment_variant: cleanIdentifier(source.experiment_variant, 50),
    utm_source: cleanText(source.utm_source, 255),
    utm_medium: cleanText(source.utm_medium, 255),
    utm_campaign: cleanText(source.utm_campaign, 255),
    utm_content: cleanText(source.utm_content, 255)
  };
}

module.exports = { normalizeEnquiryAttribution };
