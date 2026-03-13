'use strict';

/**
 * Returns the Monday (week start) of the week containing the given date.
 * All arithmetic is done in UTC to avoid timezone issues in Lambda.
 *
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {string} Monday of that week in YYYY-MM-DD format
 */
function getWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Shift to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

/**
 * Returns the Monday date string for N weeks ago from today (UTC).
 * @param {number} weeksAgo
 * @returns {string} YYYY-MM-DD
 */
function getWeekStartNWeeksAgo(weeksAgo) {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const thisMonday = getWeekStart(todayStr);
  const d = new Date(thisMonday + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - weeksAgo * 7);
  return d.toISOString().split('T')[0];
}

module.exports = { getWeekStart, getWeekStartNWeeksAgo };
