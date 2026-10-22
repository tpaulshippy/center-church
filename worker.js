export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const res = await env.ASSETS.fetch(request);

    // Serve our custom 404 page for unknown paths (but leave real assets alone).
    if (res.status === 404 && !url.pathname.includes(".")) {
      const notFound = await env.ASSETS.fetch(
        new Request(new URL("/404", url), request)
      );
      if (notFound.ok) {
        return new Response(await notFound.text(), {
          status: 404,
          headers: { "content-type": "text/html;charset=UTF-8" },
        });
      }
    }
    return res;
  },
};
