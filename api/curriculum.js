// School-scoped Curriculum discovery workspace.
// Named instructors/admins build a topic graph through threaded contributions.

const { neon } = require('@neondatabase/serverless');
const { requireAuth, getSchoolId } = require('./_auth');
const { logAudit } = require('./_audit');
const { reportError } = require('./_error-alert');

const PROMPTS = [
  { key: 'understand', label: 'What the learner needs to understand' },
  { key: 'demonstrate', label: 'What they need to demonstrate' },
  { key: 'mistakes', label: 'Common mistakes and misconceptions' },
  { key: 'approaches', label: 'Instructor teaching approaches' },
  { key: 'prerequisites', label: 'Prerequisite knowledge or skills' },
  { key: 'ready', label: 'Signs that the learner is ready to progress' },
  { key: 'thoughts', label: 'General thoughts' }
];

const PROMPT_KEYS = new Set(PROMPTS.map((prompt) => prompt.key));
const RESPONSE_TYPES = new Set([
  'build_on',
  'alternative',
  'example',
  'question',
  'connect_topic'
]);
const SUGGESTION_TYPES = new Set([
  'rename',
  'move',
  'archive',
  'merge',
  'connection',
  'other'
]);

function apiError(res, status, code, message) {
  return res.status(status).json({ error: true, code, message });
}

function textValue(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || Array.from(text).length > maxLength) return null;
  return text;
}

function optionalText(value, maxLength) {
  if (value == null || value === '') return '';
  const text = typeof value === 'string' ? value.trim() : '';
  if (Array.from(text).length > maxLength) return null;
  return text;
}

function normaliseTopicName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function resolveActor(req, res) {
  const auth = requireAuth(req, {
    roles: ['admin', 'instructor'],
    requireSchool: true
  });
  if (!auth) {
    apiError(res, 401, 'UNAUTHORISED', 'Please sign in to access Curriculum');
    return null;
  }

  const schoolId = getSchoolId(auth, req);
  if (!schoolId) {
    apiError(res, 403, 'SCHOOL_REQUIRED', 'Choose a school before opening Curriculum');
    return null;
  }

  const sql = neon(process.env.POSTGRES_URL);
  const role = auth.role || 'instructor';

  if (role === 'instructor') {
    const [instructor] = await sql`
      SELECT id, name, email, active, COALESCE(is_admin, FALSE) AS is_admin
      FROM instructors
      WHERE id = ${auth.id}
        AND school_id = ${schoolId}
    `;
    if (!instructor || !instructor.active) {
      apiError(res, 403, 'INSTRUCTOR_INACTIVE', 'Your instructor account is not active');
      return null;
    }
    return {
      sql,
      auth,
      schoolId,
      actorType: 'instructor',
      actorId: Number(instructor.id),
      actorName: instructor.name || 'Instructor',
      actorEmail: instructor.email || auth.email || '',
      isAdmin: auth.isAdmin === true && instructor.is_admin === true
    };
  }

  if (role !== 'admin') {
    apiError(res, 403, 'SCHOOL_ADMIN_REQUIRED', 'A school admin account is required');
    return null;
  }

  const [admin] = await sql`
    SELECT id, name, email, active
    FROM admin_users
    WHERE id = ${auth.id}
      AND school_id = ${schoolId}
      AND active = TRUE
  `;
  if (!admin) {
    apiError(res, 403, 'ADMIN_NOT_FOUND', 'Active school admin account not found');
    return null;
  }

  return {
    sql,
    auth,
    schoolId,
    actorType: 'admin',
    actorId: Number(admin.id),
    actorName: admin.name || 'School admin',
    actorEmail: admin.email || auth.email || '',
    isAdmin: true
  };
}

async function ensureSeedTopics(sql, schoolId) {
  await sql`
    INSERT INTO curriculum_topics (
      school_id,
      name,
      name_normalized,
      description,
      created_by_type,
      created_by_id
    )
    VALUES
      (
        ${schoolId},
        'Controls',
        'controls',
        'Explore how learners understand and use the vehicle controls.',
        'admin',
        0
      ),
      (
        ${schoolId},
        'Junctions',
        'junctions',
        'Explore observation, judgement, positioning, and decision-making at junctions.',
        'admin',
        0
      ),
      (
        ${schoolId},
        'Manoeuvres',
        'manoeuvres',
        'Explore the skills, teaching approaches, and judgement involved in manoeuvres.',
        'admin',
        0
      )
    ON CONFLICT (school_id, name_normalized)
      WHERE archived_at IS NULL AND merged_into_topic_id IS NULL
    DO NOTHING
  `;
}

async function findActiveTopic(sql, schoolId, topicId) {
  const [topic] = await sql`
    SELECT id, name, description, parent_topic_id
    FROM curriculum_topics
    WHERE id = ${topicId}
      AND school_id = ${schoolId}
      AND archived_at IS NULL
      AND merged_into_topic_id IS NULL
  `;
  return topic || null;
}

async function handleBootstrap(req, res, actor) {
  if (req.method !== 'GET') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  }

  await ensureSeedTopics(actor.sql, actor.schoolId);
  const topics = await actor.sql`
    SELECT
      t.id,
      t.name,
      t.description,
      t.parent_topic_id,
      parent.name AS parent_name,
      t.created_at,
      t.updated_at,
      COUNT(DISTINCT c.id)::int AS contribution_count,
      COUNT(DISTINCT child.id)::int AS subtopic_count,
      GREATEST(
        t.updated_at,
        COALESCE(MAX(c.updated_at), t.updated_at)
      ) AS last_activity_at
    FROM curriculum_topics t
    LEFT JOIN curriculum_topics parent
      ON parent.id = t.parent_topic_id
     AND parent.school_id = t.school_id
    LEFT JOIN curriculum_contributions c
      ON c.topic_id = t.id
     AND c.school_id = t.school_id
    LEFT JOIN curriculum_topics child
      ON child.parent_topic_id = t.id
     AND child.school_id = t.school_id
     AND child.archived_at IS NULL
     AND child.merged_into_topic_id IS NULL
    WHERE t.school_id = ${actor.schoolId}
      AND t.archived_at IS NULL
      AND t.merged_into_topic_id IS NULL
    GROUP BY t.id, parent.name
    ORDER BY
      CASE WHEN t.parent_topic_id IS NULL THEN 0 ELSE 1 END,
      t.name_normalized ASC
  `;

  let suggestions = [];
  if (actor.isAdmin) {
    suggestions = await actor.sql`
      SELECT
        s.id,
        s.topic_id,
        t.name AS topic_name,
        s.suggestion_type,
        s.details,
        s.status,
        s.created_at,
        CASE
          WHEN s.suggested_by_type = 'instructor'
            THEN COALESCE(i.name, 'Former instructor')
          ELSE COALESCE(a.name, 'School admin')
        END AS author_name
      FROM curriculum_structural_suggestions s
      JOIN curriculum_topics t
        ON t.id = s.topic_id
       AND t.school_id = s.school_id
      LEFT JOIN instructors i
        ON s.suggested_by_type = 'instructor'
       AND i.id = s.suggested_by_id
       AND i.school_id = s.school_id
      LEFT JOIN admin_users a
        ON s.suggested_by_type = 'admin'
       AND a.id = s.suggested_by_id
       AND a.school_id = s.school_id
      WHERE s.school_id = ${actor.schoolId}
        AND s.status = 'pending'
      ORDER BY s.created_at ASC, s.id ASC
    `;
  }

  return res.json({
    ok: true,
    actor: {
      id: actor.actorId,
      type: actor.actorType,
      name: actor.actorName,
      is_admin: actor.isAdmin
    },
    prompts: PROMPTS,
    topics,
    suggestions
  });
}

async function handleTopic(req, res, actor) {
  if (req.method !== 'GET') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'GET required');
  }

  const topicId = numericId(req.query.id);
  if (!topicId) return apiError(res, 400, 'TOPIC_REQUIRED', 'Valid topic id required');

  const [topic] = await actor.sql`
    SELECT
      t.id,
      t.name,
      t.description,
      t.parent_topic_id,
      parent.name AS parent_name,
      t.archived_at,
      t.merged_into_topic_id,
      merged.name AS merged_into_name,
      t.created_at,
      t.updated_at
    FROM curriculum_topics t
    LEFT JOIN curriculum_topics parent
      ON parent.id = t.parent_topic_id
     AND parent.school_id = t.school_id
    LEFT JOIN curriculum_topics merged
      ON merged.id = t.merged_into_topic_id
     AND merged.school_id = t.school_id
    WHERE t.id = ${topicId}
      AND t.school_id = ${actor.schoolId}
  `;
  if (!topic) return apiError(res, 404, 'TOPIC_NOT_FOUND', 'Topic not found');

  if (topic.merged_into_topic_id) {
    return res.json({
      ok: true,
      merged_into: {
        id: topic.merged_into_topic_id,
        name: topic.merged_into_name
      }
    });
  }

  const [subtopics, connections, contributions] = await Promise.all([
    actor.sql`
      SELECT id, name, description, updated_at
      FROM curriculum_topics
      WHERE school_id = ${actor.schoolId}
        AND parent_topic_id = ${topicId}
        AND archived_at IS NULL
        AND merged_into_topic_id IS NULL
      ORDER BY name_normalized ASC
    `,
    actor.sql`
      SELECT
        connection.id,
        connection.label,
        other.id AS topic_id,
        other.name AS topic_name,
        other.description AS topic_description
      FROM curriculum_topic_connections connection
      JOIN curriculum_topics other
        ON other.school_id = connection.school_id
       AND other.id = CASE
         WHEN connection.left_topic_id = ${topicId}
           THEN connection.right_topic_id
         ELSE connection.left_topic_id
       END
      WHERE connection.school_id = ${actor.schoolId}
        AND (
          connection.left_topic_id = ${topicId}
          OR connection.right_topic_id = ${topicId}
        )
        AND other.archived_at IS NULL
        AND other.merged_into_topic_id IS NULL
      ORDER BY other.name_normalized ASC
    `,
    actor.sql`
      SELECT
        c.id,
        c.topic_id,
        c.prompt_key,
        c.parent_contribution_id,
        c.response_type,
        c.linked_topic_id,
        linked.name AS linked_topic_name,
        c.author_type,
        c.author_id,
        c.body,
        c.created_at,
        c.updated_at,
        c.edited_at,
        CASE
          WHEN c.author_type = 'instructor' AND i.id IS NULL
            THEN 'Former instructor'
          WHEN c.author_type = 'instructor' AND i.active = FALSE
            THEN COALESCE(i.name, 'Former instructor') || ' (former instructor)'
          WHEN c.author_type = 'instructor'
            THEN COALESCE(i.name, 'Instructor')
          ELSE COALESCE(a.name, 'School admin')
        END AS author_name,
        (
          c.author_type = ${actor.actorType}
          AND c.author_id = ${actor.actorId}
        ) AS is_own
      FROM curriculum_contributions c
      LEFT JOIN instructors i
        ON c.author_type = 'instructor'
       AND i.id = c.author_id
       AND i.school_id = c.school_id
      LEFT JOIN admin_users a
        ON c.author_type = 'admin'
       AND a.id = c.author_id
       AND a.school_id = c.school_id
      LEFT JOIN curriculum_topics linked
        ON linked.id = c.linked_topic_id
       AND linked.school_id = c.school_id
      WHERE c.school_id = ${actor.schoolId}
        AND c.topic_id = ${topicId}
      ORDER BY c.created_at ASC, c.id ASC
    `
  ]);

  return res.json({
    ok: true,
    actor: {
      id: actor.actorId,
      type: actor.actorType,
      name: actor.actorName,
      is_admin: actor.isAdmin
    },
    prompts: PROMPTS,
    topic,
    subtopics,
    connections,
    contributions
  });
}

async function handleCreateTopic(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }

  const name = textValue(req.body?.name, 120);
  const description = optionalText(req.body?.description, 1200);
  const parentTopicId = req.body?.parent_topic_id == null || req.body.parent_topic_id === ''
    ? null
    : numericId(req.body.parent_topic_id);
  if (!name) return apiError(res, 400, 'INVALID_TOPIC_NAME', 'Enter a topic name up to 120 characters');
  if (description == null) return apiError(res, 400, 'INVALID_DESCRIPTION', 'Description must be 1,200 characters or fewer');
  if (req.body?.parent_topic_id != null && req.body.parent_topic_id !== '' && !parentTopicId) {
    return apiError(res, 400, 'INVALID_PARENT', 'Choose a valid parent topic');
  }
  if (parentTopicId && !(await findActiveTopic(actor.sql, actor.schoolId, parentTopicId))) {
    return apiError(res, 404, 'PARENT_NOT_FOUND', 'Parent topic not found');
  }

  const normalized = normaliseTopicName(name);
  const matches = await actor.sql`
    SELECT id, name, description, parent_topic_id
    FROM curriculum_topics
    WHERE school_id = ${actor.schoolId}
      AND archived_at IS NULL
      AND merged_into_topic_id IS NULL
      AND (
        name_normalized = ${normalized}
        OR name_normalized LIKE ${'%' + normalized + '%'}
        OR ${normalized} LIKE ('%' || name_normalized || '%')
      )
    ORDER BY
      CASE WHEN name_normalized = ${normalized} THEN 0 ELSE 1 END,
      name_normalized ASC
    LIMIT 8
  `;
  if (matches.some((match) => match.name.toLocaleLowerCase('en-GB') === normalized)) {
    return res.status(409).json({
      error: true,
      code: 'TOPIC_ALREADY_EXISTS',
      message: 'A topic with this name already exists',
      matches
    });
  }

  try {
    const [topic] = await actor.sql`
      INSERT INTO curriculum_topics (
        school_id,
        name,
        name_normalized,
        description,
        parent_topic_id,
        created_by_type,
        created_by_id
      )
      VALUES (
        ${actor.schoolId},
        ${name},
        ${normalized},
        ${description || null},
        ${parentTopicId},
        ${actor.actorType},
        ${actor.actorId}
      )
      RETURNING id, name, description, parent_topic_id, created_at, updated_at
    `;
    return res.status(201).json({ ok: true, topic, matches });
  } catch (err) {
    if (err && err.code === '23505') {
      return apiError(res, 409, 'TOPIC_ALREADY_EXISTS', 'A topic with this name already exists');
    }
    throw err;
  }
}

async function handleCreateConnection(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }
  const topicId = numericId(req.body?.topic_id);
  const relatedTopicId = numericId(req.body?.related_topic_id);
  const label = optionalText(req.body?.label, 180);
  if (!topicId || !relatedTopicId || topicId === relatedTopicId) {
    return apiError(res, 400, 'INVALID_CONNECTION', 'Choose two different topics');
  }
  if (label == null) return apiError(res, 400, 'INVALID_LABEL', 'Connection label must be 180 characters or fewer');

  const topics = await actor.sql`
    SELECT id
    FROM curriculum_topics
    WHERE school_id = ${actor.schoolId}
      AND id = ANY(${[topicId, relatedTopicId]}::bigint[])
      AND archived_at IS NULL
      AND merged_into_topic_id IS NULL
  `;
  if (topics.length !== 2) {
    return apiError(res, 404, 'TOPIC_NOT_FOUND', 'One of the topics was not found');
  }

  const leftTopicId = Math.min(topicId, relatedTopicId);
  const rightTopicId = Math.max(topicId, relatedTopicId);
  const [connection] = await actor.sql`
    INSERT INTO curriculum_topic_connections (
      school_id,
      left_topic_id,
      right_topic_id,
      label,
      created_by_type,
      created_by_id
    )
    VALUES (
      ${actor.schoolId},
      ${leftTopicId},
      ${rightTopicId},
      ${label || null},
      ${actor.actorType},
      ${actor.actorId}
    )
    ON CONFLICT (school_id, left_topic_id, right_topic_id)
    DO UPDATE SET label = COALESCE(EXCLUDED.label, curriculum_topic_connections.label)
    RETURNING id, left_topic_id, right_topic_id, label, created_at
  `;
  await actor.sql`
    UPDATE curriculum_topics
    SET updated_at = NOW()
    WHERE school_id = ${actor.schoolId}
      AND id = ANY(${[topicId, relatedTopicId]}::bigint[])
  `;
  return res.status(201).json({ ok: true, connection });
}

async function handleCreateContribution(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }
  const topicId = numericId(req.body?.topic_id);
  const promptKey = String(req.body?.prompt_key || '');
  const body = textValue(req.body?.body, 5000);
  const parentContributionId = req.body?.parent_contribution_id == null
    ? null
    : numericId(req.body.parent_contribution_id);
  const responseType = parentContributionId ? String(req.body?.response_type || '') : null;
  const linkedTopicId = req.body?.linked_topic_id == null || req.body.linked_topic_id === ''
    ? null
    : numericId(req.body.linked_topic_id);

  if (!topicId || !PROMPT_KEYS.has(promptKey)) {
    return apiError(res, 400, 'INVALID_CONTRIBUTION', 'Choose a valid topic and contribution area');
  }
  if (!body) return apiError(res, 400, 'INVALID_BODY', 'Write between 1 and 5,000 characters');
  if (parentContributionId && !RESPONSE_TYPES.has(responseType)) {
    return apiError(res, 400, 'INVALID_RESPONSE_TYPE', 'Choose how you would like to respond');
  }
  if (req.body?.parent_contribution_id != null && !parentContributionId) {
    return apiError(res, 400, 'INVALID_PARENT_CONTRIBUTION', 'Choose a valid conversation');
  }
  if (req.body?.linked_topic_id != null && req.body.linked_topic_id !== '' && !linkedTopicId) {
    return apiError(res, 400, 'INVALID_LINKED_TOPIC', 'Choose a valid linked topic');
  }
  if (responseType === 'connect_topic' && (!linkedTopicId || linkedTopicId === topicId)) {
    return apiError(res, 400, 'INVALID_LINKED_TOPIC', 'Choose a different topic to connect');
  }
  if (responseType !== 'connect_topic' && linkedTopicId) {
    return apiError(res, 400, 'INVALID_LINKED_TOPIC', 'Linked topics require a topic connection response');
  }
  if (!(await findActiveTopic(actor.sql, actor.schoolId, topicId))) {
    return apiError(res, 404, 'TOPIC_NOT_FOUND', 'Topic not found');
  }

  if (parentContributionId) {
    const [parent] = await actor.sql`
      SELECT id
      FROM curriculum_contributions
      WHERE id = ${parentContributionId}
        AND school_id = ${actor.schoolId}
        AND topic_id = ${topicId}
        AND prompt_key = ${promptKey}
    `;
    if (!parent) {
      return apiError(res, 404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
  }

  if (linkedTopicId && !(await findActiveTopic(actor.sql, actor.schoolId, linkedTopicId))) {
    return apiError(res, 404, 'LINKED_TOPIC_NOT_FOUND', 'Linked topic not found');
  }

  const [contribution] = await actor.sql`
    INSERT INTO curriculum_contributions (
      school_id,
      topic_id,
      prompt_key,
      parent_contribution_id,
      response_type,
      linked_topic_id,
      author_type,
      author_id,
      body
    )
    VALUES (
      ${actor.schoolId},
      ${topicId},
      ${promptKey},
      ${parentContributionId},
      ${responseType},
      ${linkedTopicId},
      ${actor.actorType},
      ${actor.actorId},
      ${body}
    )
    RETURNING
      id,
      topic_id,
      prompt_key,
      parent_contribution_id,
      response_type,
      linked_topic_id,
      body,
      created_at,
      updated_at,
      edited_at
  `;

  if (responseType === 'connect_topic' && linkedTopicId && linkedTopicId !== topicId) {
    const leftTopicId = Math.min(topicId, linkedTopicId);
    const rightTopicId = Math.max(topicId, linkedTopicId);
    await actor.sql`
      INSERT INTO curriculum_topic_connections (
        school_id,
        left_topic_id,
        right_topic_id,
        created_by_type,
        created_by_id
      )
      VALUES (
        ${actor.schoolId},
        ${leftTopicId},
        ${rightTopicId},
        ${actor.actorType},
        ${actor.actorId}
      )
      ON CONFLICT (school_id, left_topic_id, right_topic_id) DO NOTHING
    `;
  }

  await actor.sql`
    UPDATE curriculum_topics
    SET updated_at = NOW()
    WHERE id = ${topicId}
      AND school_id = ${actor.schoolId}
  `;

  return res.status(201).json({
    ok: true,
    contribution: {
      ...contribution,
      author_type: actor.actorType,
      author_id: actor.actorId,
      author_name: actor.actorName,
      is_own: true
    }
  });
}

async function handleEditContribution(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }
  const contributionId = numericId(req.body?.id);
  const body = textValue(req.body?.body, 5000);
  if (!contributionId || !body) {
    return apiError(res, 400, 'INVALID_CONTRIBUTION', 'Valid contribution and text required');
  }

  const [existing] = await actor.sql`
    SELECT id, author_type, author_id
    FROM curriculum_contributions
    WHERE id = ${contributionId}
      AND school_id = ${actor.schoolId}
  `;
  if (!existing) return apiError(res, 404, 'CONTRIBUTION_NOT_FOUND', 'Contribution not found');
  if (existing.author_type !== actor.actorType || Number(existing.author_id) !== actor.actorId) {
    return apiError(res, 403, 'NOT_CONTRIBUTION_OWNER', 'You can only edit your own words');
  }

  const [contribution] = await actor.sql`
    UPDATE curriculum_contributions
    SET body = ${body},
        updated_at = NOW(),
        edited_at = NOW()
    WHERE id = ${contributionId}
      AND school_id = ${actor.schoolId}
      AND author_type = ${actor.actorType}
      AND author_id = ${actor.actorId}
    RETURNING id, body, updated_at, edited_at
  `;
  return res.json({ ok: true, contribution });
}

async function handleSuggestStructure(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }
  const topicId = numericId(req.body?.topic_id);
  const suggestionType = String(req.body?.suggestion_type || '');
  const details = textValue(req.body?.details, 2000);
  if (!topicId || !SUGGESTION_TYPES.has(suggestionType) || !details) {
    return apiError(res, 400, 'INVALID_SUGGESTION', 'Choose a suggestion type and add some detail');
  }
  if (!(await findActiveTopic(actor.sql, actor.schoolId, topicId))) {
    return apiError(res, 404, 'TOPIC_NOT_FOUND', 'Topic not found');
  }

  const [suggestion] = await actor.sql`
    INSERT INTO curriculum_structural_suggestions (
      school_id,
      topic_id,
      suggestion_type,
      details,
      suggested_by_type,
      suggested_by_id
    )
    VALUES (
      ${actor.schoolId},
      ${topicId},
      ${suggestionType},
      ${details},
      ${actor.actorType},
      ${actor.actorId}
    )
    RETURNING id, topic_id, suggestion_type, details, status, created_at
  `;
  return res.status(201).json({ ok: true, suggestion });
}

async function ensureAdmin(actor, res) {
  if (actor.isAdmin) return true;
  apiError(res, 403, 'ADMIN_REQUIRED', 'A school admin is required for this action');
  return false;
}

async function assertSafeParent(sql, schoolId, topicId, parentTopicId) {
  if (!parentTopicId) return true;
  if (topicId === parentTopicId) return false;
  const [cycle] = await sql`
    WITH RECURSIVE descendants AS (
      SELECT id
      FROM curriculum_topics
      WHERE parent_topic_id = ${topicId}
        AND school_id = ${schoolId}
      UNION ALL
      SELECT child.id
      FROM curriculum_topics child
      JOIN descendants d ON child.parent_topic_id = d.id
      WHERE child.school_id = ${schoolId}
    )
    SELECT id
    FROM descendants
    WHERE id = ${parentTopicId}
    LIMIT 1
  `;
  return !cycle;
}

async function handleAdminTopic(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }
  if (!(await ensureAdmin(actor, res))) return;

  const topicId = numericId(req.body?.topic_id);
  const operation = String(req.body?.operation || '');
  if (!topicId) return apiError(res, 400, 'TOPIC_REQUIRED', 'Valid topic id required');
  const topic = await findActiveTopic(actor.sql, actor.schoolId, topicId);
  if (!topic) return apiError(res, 404, 'TOPIC_NOT_FOUND', 'Active topic not found');

  let result;
  let details = { operation };

  if (operation === 'rename') {
    const name = textValue(req.body?.name, 120);
    const description = optionalText(req.body?.description, 1200);
    if (!name || description == null) {
      return apiError(res, 400, 'INVALID_TOPIC', 'Enter a valid name and description');
    }
    result = (await actor.sql`
      UPDATE curriculum_topics
      SET name = ${name},
          name_normalized = ${normaliseTopicName(name)},
          description = ${description || null},
          updated_at = NOW()
      WHERE id = ${topicId}
        AND school_id = ${actor.schoolId}
      RETURNING id, name, description, parent_topic_id, updated_at
    `)[0];
    details = { operation, previous_name: topic.name, name };
  } else if (operation === 'move') {
    const parentTopicId = req.body?.parent_topic_id == null || req.body.parent_topic_id === ''
      ? null
      : numericId(req.body.parent_topic_id);
    if (req.body?.parent_topic_id != null && req.body.parent_topic_id !== '' && !parentTopicId) {
      return apiError(res, 400, 'INVALID_PARENT', 'Choose a valid parent topic');
    }
    if (parentTopicId && !(await findActiveTopic(actor.sql, actor.schoolId, parentTopicId))) {
      return apiError(res, 404, 'PARENT_NOT_FOUND', 'Parent topic not found');
    }
    if (!(await assertSafeParent(actor.sql, actor.schoolId, topicId, parentTopicId))) {
      return apiError(res, 409, 'TOPIC_CYCLE', 'A topic cannot be moved beneath itself or one of its subtopics');
    }
    result = (await actor.sql`
      UPDATE curriculum_topics
      SET parent_topic_id = ${parentTopicId},
          updated_at = NOW()
      WHERE id = ${topicId}
        AND school_id = ${actor.schoolId}
      RETURNING id, name, description, parent_topic_id, updated_at
    `)[0];
    details = { operation, previous_parent_topic_id: topic.parent_topic_id, parent_topic_id: parentTopicId };
  } else if (operation === 'archive') {
    result = (await actor.sql`
      UPDATE curriculum_topics
      SET archived_at = NOW(),
          archived_by_admin_id = ${actor.actorId},
          updated_at = NOW()
      WHERE id = ${topicId}
        AND school_id = ${actor.schoolId}
      RETURNING id, name, archived_at
    `)[0];
  } else if (operation === 'merge') {
    const targetTopicId = numericId(req.body?.target_topic_id);
    if (!targetTopicId || targetTopicId === topicId) {
      return apiError(res, 400, 'INVALID_MERGE_TARGET', 'Choose a different topic to keep');
    }
    const target = await findActiveTopic(actor.sql, actor.schoolId, targetTopicId);
    if (!target) return apiError(res, 404, 'MERGE_TARGET_NOT_FOUND', 'Merge target not found');
    if (!(await assertSafeParent(actor.sql, actor.schoolId, topicId, targetTopicId))) {
      return apiError(res, 409, 'MERGE_CYCLE', 'A topic cannot be merged into one of its subtopics');
    }

    const mergeResults = await actor.sql.transaction([
      actor.sql`
        UPDATE curriculum_topics
        SET parent_topic_id = ${targetTopicId},
            updated_at = NOW()
        WHERE school_id = ${actor.schoolId}
          AND parent_topic_id = ${topicId}
          AND id <> ${targetTopicId}
      `,
      actor.sql`
        UPDATE curriculum_topics
        SET merged_into_topic_id = ${targetTopicId},
            updated_at = NOW()
        WHERE id = ${topicId}
          AND school_id = ${actor.schoolId}
        RETURNING id, name, merged_into_topic_id, updated_at
      `
    ]);
    result = mergeResults[1][0];
    details = { operation, target_topic_id: targetTopicId, target_name: target.name };
  } else {
    return apiError(res, 400, 'INVALID_ADMIN_OPERATION', 'Unknown topic operation');
  }

  await logAudit(actor.sql, {
    adminId: actor.actorId,
    adminEmail: actor.actorEmail,
    action: `curriculum.topic_${operation}`,
    targetType: 'curriculum_topic',
    targetId: topicId,
    details,
    schoolId: actor.schoolId,
    req
  });
  return res.json({ ok: true, topic: result });
}

async function handleReviewSuggestion(req, res, actor) {
  if (req.method !== 'POST') {
    return apiError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required');
  }
  if (!(await ensureAdmin(actor, res))) return;

  const suggestionId = numericId(req.body?.suggestion_id);
  const status = String(req.body?.status || '');
  const reviewNote = optionalText(req.body?.review_note, 1200);
  if (!suggestionId || !['accepted', 'rejected'].includes(status) || reviewNote == null) {
    return apiError(res, 400, 'INVALID_REVIEW', 'Choose accept or reject and use a valid review note');
  }

  const [suggestion] = await actor.sql`
    UPDATE curriculum_structural_suggestions
    SET status = ${status},
        reviewed_at = NOW(),
        reviewed_by_admin_id = ${actor.actorId},
        review_note = ${reviewNote || null}
    WHERE id = ${suggestionId}
      AND school_id = ${actor.schoolId}
      AND status = 'pending'
    RETURNING id, topic_id, suggestion_type, status, reviewed_at, review_note
  `;
  if (!suggestion) {
    return apiError(res, 404, 'SUGGESTION_NOT_FOUND', 'Pending suggestion not found');
  }

  await logAudit(actor.sql, {
    adminId: actor.actorId,
    adminEmail: actor.actorEmail,
    action: 'curriculum.suggestion_review',
    targetType: 'curriculum_structural_suggestion',
    targetId: suggestionId,
    details: { status, topic_id: suggestion.topic_id, suggestion_type: suggestion.suggestion_type },
    schoolId: actor.schoolId,
    req
  });
  return res.json({ ok: true, suggestion });
}

module.exports = async function curriculumHandler(req, res) {
  const action = String(req.query.action || '');
  try {
    const actor = await resolveActor(req, res);
    if (!actor) return;

    if (action === 'bootstrap') return await handleBootstrap(req, res, actor);
    if (action === 'topic') return await handleTopic(req, res, actor);
    if (action === 'create-topic') return await handleCreateTopic(req, res, actor);
    if (action === 'create-connection') return await handleCreateConnection(req, res, actor);
    if (action === 'create-contribution') return await handleCreateContribution(req, res, actor);
    if (action === 'edit-contribution') return await handleEditContribution(req, res, actor);
    if (action === 'suggest-structure') return await handleSuggestStructure(req, res, actor);
    if (action === 'admin-topic') return await handleAdminTopic(req, res, actor);
    if (action === 'review-suggestion') return await handleReviewSuggestion(req, res, actor);

    return apiError(res, 400, 'UNKNOWN_ACTION', 'Unknown Curriculum action');
  } catch (err) {
    console.error('curriculum error:', err);
    reportError('/api/curriculum', err);
    if (err && err.code === '23505') {
      return apiError(res, 409, 'DUPLICATE_CURRICULUM_RECORD', 'That Curriculum item already exists');
    }
    return apiError(res, 500, 'CURRICULUM_FAILED', 'Curriculum could not complete that request');
  }
};

module.exports._PROMPTS = PROMPTS;
module.exports._normaliseTopicName = normaliseTopicName;
