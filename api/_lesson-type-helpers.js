const OPT_IN_ONLY_LESSON_TYPE_SLUGS = ['1hr'];

function isOptInOnlyLessonTypeSlug(slug) {
  return OPT_IN_ONLY_LESSON_TYPE_SLUGS.includes(String(slug || ''));
}

function isLessonTypeOffered(offeredLessonTypes, slug) {
  if (Array.isArray(offeredLessonTypes)) return offeredLessonTypes.includes(slug);
  return !isOptInOnlyLessonTypeSlug(slug);
}

module.exports = {
  OPT_IN_ONLY_LESSON_TYPE_SLUGS,
  isOptInOnlyLessonTypeSlug,
  isLessonTypeOffered,
};
