const jwt = require('jsonwebtoken');

function verifyAuth(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    return jwt.verify(auth.slice(7), secret);
  } catch {
    return null;
  }
}

module.exports = verifyAuth;
