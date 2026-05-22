// Interactive Neon transaction helper.
//
// The regular `neon()` HTTP query function only supports standalone queries
// and non-interactive `sql.transaction([...])` batches. Step 5's atomic
// credit-funded booking writer needs returned IDs and row locks across
// multiple statements, so it must use a request-scoped Client.

const { Client, neonConfig } = require('@neondatabase/serverless');

function configureWebSocketSupport() {
  if (!neonConfig.webSocketConstructor && typeof globalThis.WebSocket === 'function') {
    neonConfig.webSocketConstructor = globalThis.WebSocket;
  }

  if (!neonConfig.webSocketConstructor) {
    throw new Error(
      'Neon interactive transactions require WebSocket support. ' +
      'On Node runtimes without global WebSocket, set neonConfig.webSocketConstructor to a WebSocket implementation before calling withNeonTransaction.'
    );
  }
}

function normalizeOptions(options) {
  if (typeof options === 'string') {
    return { connectionString: options };
  }
  if (!options || typeof options !== 'object') {
    throw new Error('withNeonTransaction requires a connection string or options object');
  }
  return options;
}

async function withNeonTransaction(options, callback) {
  const { connectionString, clientConfig = {} } = normalizeOptions(options);
  if (!connectionString) {
    throw new Error('withNeonTransaction requires connectionString');
  }
  if (typeof callback !== 'function') {
    throw new Error('withNeonTransaction requires an async callback');
  }

  configureWebSocketSupport();

  const client = new Client({ connectionString, ...clientConfig });
  let began = false;
  let committed = false;

  try {
    await client.connect();
    await client.query('BEGIN');
    began = true;

    const result = await callback(client);

    await client.query('COMMIT');
    committed = true;
    return result;
  } catch (err) {
    if (began && !committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        if (err && typeof err === 'object') {
          err.rollbackError = rollbackErr;
        }
      }
    }
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  withNeonTransaction,
  configureWebSocketSupport,
};
