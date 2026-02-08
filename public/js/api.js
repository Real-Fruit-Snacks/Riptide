window.Riptide = window.Riptide || {};

/**
 * Shared fetch wrapper with auth headers and error handling.
 * @param {string} url - API endpoint
 * @param {Object} [opts] - fetch options (method, body, headers, etc.)
 * @returns {Promise<any>} Parsed JSON response (or null for 204)
 * @throws {Error} With server error message if available
 */
Riptide.api = async function api(url, opts = {}) {
  const headers = Riptide.Auth ? Riptide.Auth.getHeaders() : { 'Content-Type': 'application/json' };

  // Merge any extra headers from opts
  if (opts.headers) {
    Object.assign(headers, opts.headers);
  }

  const fetchOpts = { ...opts, headers };

  // Auto-stringify body if it's a plain object (not FormData, ArrayBuffer, etc.)
  if (fetchOpts.body && typeof fetchOpts.body === 'object'
      && !(fetchOpts.body instanceof FormData)
      && !(fetchOpts.body instanceof ArrayBuffer)
      && !(fetchOpts.body instanceof Blob)) {
    fetchOpts.body = JSON.stringify(fetchOpts.body);
  }

  // Don't set Content-Type for FormData (browser sets it with boundary)
  if (opts.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const res = await fetch(url, fetchOpts);

  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const err = await res.json();
      if (err.error) msg = err.error;
    } catch (_) { /* response wasn't JSON */ }
    throw new Error(msg);
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return null;

  // Try to parse as JSON, fall back to returning the raw response
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }

  // For non-JSON responses return null (most DELETE endpoints)
  return null;
};
