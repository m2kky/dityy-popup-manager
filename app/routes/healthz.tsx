export const loader = () =>
  new Response("ok", {
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
