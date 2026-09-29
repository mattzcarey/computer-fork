import { DurableObject } from "cloudflare:workers";

import {
  type DurableObjectStorageLike,
  getWorkspace,
  type WorkspaceRuntimeValue,
  withWorkspace,
} from "@cloudflare/computer";
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";

import { createJevModule } from "./jev";

// Generated modules import `classify` from "jev". It forwards to the
// host-owned ws:jev module, which is the only way out to the model.
const JEV_MODULE = `
import { call } from "ws:jev";
export const classify = (states, questions) => call("classify", states, questions);
`;

export class ClassifyExample extends withWorkspace(class extends DurableObject<Env> {}, (self) => {
  const { ctx, env } = self as unknown as { ctx: DurableObjectState; env: Env };
  return {
    storage: ctx.storage as unknown as DurableObjectStorageLike,
    backends: [
      new WorkerJavaScriptBackend({
        loader: env.LOADER,
        egress: { mode: "none" },
        modules: { jev: JEV_MODULE },
        trustedModules: { "ws:jev": createJevModule(env.AI, env.AI_GATEWAY_ID) },
      }),
    ],
  };
}) {}

interface ExecRequest {
  source?: string;
  input?: WorkspaceRuntimeValue;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/c\/([^/]+)\/(file\/workspace\/.+|exec\/?)$/);
    if (!match) {
      return new Response(
        [
          "classify example",
          "",
          "  PUT  /c/<name>/file/workspace/<path>   write file at /workspace/<path>",
          "  POST /c/<name>/exec                    run an ECMAScript module with jev available",
          "",
        ].join("\n"),
        { status: url.pathname === "/" ? 200 : 404, headers: { "content-type": "text/plain" } },
      );
    }

    const stub = env.ClassifyExample.get(env.ClassifyExample.idFromName(match[1]));
    const ws = await getWorkspace(stub as unknown as Parameters<typeof getWorkspace>[0]);

    try {
      if (match[2].startsWith("file/") && request.method === "PUT") {
        const path = `/${match[2].slice("file/".length)}`;
        if (path.split("/").includes("..")) return errorJSON(new Error("invalid path"), 400);
        await ws.fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
        await ws.fs.writeFile(path, new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { status: 204 });
      }
      if (match[2].startsWith("exec") && request.method === "POST") {
        const body = (await request.json()) as ExecRequest;
        if (typeof body.source !== "string")
          return errorJSON(new Error("must provide source"), 400);
        const handle = await ws.runtime.exec(body.source, {
          backend: "worker-javascript",
          input: body.input,
          encoding: "utf8",
        });
        return Response.json(await handle.result());
      }
      return new Response("method not allowed", { status: 405 });
    } catch (error) {
      return errorJSON(error, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function errorJSON(error: unknown, status: number): Response {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}
