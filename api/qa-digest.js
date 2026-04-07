// Q&A Email Digest — sends a daily summary of unanswered questions to instructors
// Called via Vercel Cron or manually: GET /api/qa-digest?key=CRON_SECRET
//
// Set CRON_SECRET env var to protect the endpoint.

const { neon } = require('@neondatabase/serverless');
const { createTransporter } = require('./_auth-helpers');
const { reportError } = require('./_error-alert');

module.exports = async (req, res) => {
  // Protect with a secret key
  const secret = process.env.CRON_SECRET;
  const provided = req.query.key || req.headers['authorization']?.replace('Bearer ', '');
  if (secret && provided !== secret) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);

    // Find unanswered questions older than 1 hour (with school context)
    const openQuestions = await sql`
      SELECT q.id, q.title, q.created_at, lu.name AS learner_name, lu.school_id
      FROM qa_questions q
      JOIN learner_users lu ON lu.id = q.learner_id
      WHERE q.status = 'open'
        AND q.created_at < NOW() - INTERVAL '1 hour'
      ORDER BY q.created_at ASC
      LIMIT 20
    `;

    if (openQuestions.length === 0) {
      return res.json({ sent: false, reason: 'No unanswered questions' });
    }

    // Group questions by school_id
    const bySchool = {};
    for (const q of openQuestions) {
      const sid = q.school_id || 1;
      if (!bySchool[sid]) bySchool[sid] = [];
      bySchool[sid].push(q);
    }

    const mailer = createTransporter();
    let sentCount = 0;
    let totalQuestions = openQuestions.length;

    // For each school, send digest only to that school's instructors
    for (const [schoolId, questions] of Object.entries(bySchool)) {
      const instructors = await sql`
        SELECT id, name, email FROM instructors
        WHERE active = TRUE AND school_id = ${parseInt(schoolId)}
      `;

      if (instructors.length === 0) continue;

      // Build question list HTML for this school
      const questionsHtml = questions.map(q => {
        const ago = timeSince(new Date(q.created_at));
        return `<li style="margin-bottom:8px">
          <strong>${escHtml(q.title)}</strong>
          <span style="color:#888;font-size:0.85rem"> — from ${escHtml(q.learner_name)}, ${ago} ago</span>
        </li>`;
      }).join('');

      for (const inst of instructors) {
        try {
          const firstName = inst.name.split(' ')[0] || 'there';
          await mailer.sendMail({
            from: 'CoachCarter <system@coachcarter.uk>',
            to: inst.email,
            subject: `${questions.length} unanswered learner question${questions.length > 1 ? 's' : ''} waiting`,
            html: `
              <h2>Hi ${firstName},</h2>
              <p>You have <strong>${questions.length} unanswered question${questions.length > 1 ? 's' : ''}</strong> from learners:</p>
              <ul style="padding-left:20px">${questionsHtml}</ul>
              <p style="margin:28px 0">
                <a href="https://coachcarter.uk/instructor/qa.html"
                   style="background:#f58321;color:white;padding:14px 28px;text-decoration:none;
                          border-radius:8px;display:inline-block;font-weight:bold;font-size:1rem;">
                  Answer questions
                </a>
              </p>
              <p style="color:#888;font-size:0.85rem;">
                This is a daily digest. Responding promptly helps your learners stay on track.
              </p>
            `
          });
          sentCount++;
        } catch (err) {
          console.error(`Failed to send digest to ${inst.email}:`, err);
        }
      }
    }

    return res.json({ sent: true, questionCount: totalQuestions, instructorsSent: sentCount });

  } catch (err) {
    console.error('qa-digest error:', err);
    reportError('/api/qa-digest', err);
    return res.status(500).json({ error: 'Failed to send digest' });
  }
};

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd';
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
