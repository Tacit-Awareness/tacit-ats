// Any /api/* path no other route answers. Next renders _not-found as a page
// for methods a page cannot take, which reaches a caller as 200 + HTML: a
// bot or webhook POSTing to a mistyped path would read that as success.
// API callers get a status they can act on instead.

async function notFound(): Promise<Response> {
  return new Response(null, { status: 404 });
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE, notFound as HEAD, notFound as OPTIONS };
