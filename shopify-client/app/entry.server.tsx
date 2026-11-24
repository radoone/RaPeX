import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter, type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 15_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={routerContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Give React time to flush rejected boundaries after the data stream times out.
    setTimeout(abort, streamTimeout + 1000);
  });
}
