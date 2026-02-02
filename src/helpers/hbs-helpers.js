/**
 * Handlebars helpers used across all templates.
 */
module.exports = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  or: (a, b) => a || b,
  and: (a, b) => a && b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  json: (obj) => JSON.stringify(obj, null, 2),
  parseJson: (str) => {
    try { return JSON.parse(str); } catch { return []; }
  },
  truncate: (str, len) => {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.substring(0, len) + '...';
  },
  capitalize: (str) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  },
  formatDate: (str) => {
    if (!str) return '';
    return new Date(str).toLocaleDateString('en-CA', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  },
  badgeClass: (status) => {
    const map = {
      cold: 'bg-secondary', warm: 'bg-warning text-dark', hot: 'bg-danger',
      converted: 'bg-success', lost: 'bg-dark',
      unknown: 'bg-secondary', leaning: 'bg-info text-dark',
      committed: 'bg-success', opposed: 'bg-danger',
      none: 'bg-secondary', potential: 'bg-info text-dark', donated: 'bg-success',
      queued: 'bg-secondary', running: 'bg-primary', completed: 'bg-success', failed: 'bg-danger',
      draft: 'bg-secondary', sent: 'bg-info', delivered: 'bg-primary',
      opened: 'bg-warning text-dark', replied: 'bg-success', bounced: 'bg-danger',
    };
    return map[status] || 'bg-secondary';
  },
  sentimentColor: (score) => {
    if (score == null) return '#6c757d';
    if (score >= 50) return '#198754';
    if (score >= 0) return '#ffc107';
    return '#dc3545';
  },
  repeat: function (n, options) {
    let out = '';
    for (let i = 0; i < n; i++) out += options.fn({ index: i });
    return out;
  },
  includes: (arr, val) => {
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr); } catch { return false; }
    }
    return Array.isArray(arr) && arr.includes(val);
  },
};
