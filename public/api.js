window.api = (() => {
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data?.error || res.statusText || 'Request gagal');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  return {
    call,
    get:   (u)    => call('GET',   u),
    post:  (u, b) => call('POST',  u, b),
    patch: (u, b) => call('PATCH', u, b),
    del:   (u)    => call('DELETE', u),
    me: async () => {
      try { return await call('GET', '/api/auth/me'); }
      catch (e) { if (e.status === 401) return null; throw e; }
    }
  };
})();