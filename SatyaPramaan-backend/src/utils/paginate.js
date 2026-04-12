function buildCursorQuery(limit = 20, cursor = null, sortField = "createdAt") {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const query = {};

  if (cursor) {
    query[sortField] = { $lt: new Date(cursor) };
  }

  return { safeLimit, query };
}

module.exports = { buildCursorQuery };
