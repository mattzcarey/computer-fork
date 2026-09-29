import type { WorkspaceRuntimeValue, WorkspaceTrustedModule } from "@cloudflare/computer";

const MODEL = "typesafe/jev";
const MAX_STATES = 100;
const MAX_CONCURRENCY = 8;

type Questions = Record<string, WorkspaceRuntimeValue>;
type Answers = Record<string, WorkspaceRuntimeValue>;

// The Jev input shape isn't in the generated Ai types, so call run()
// through a minimal typed view. Keep the call on the binding itself:
// run() relies on its own `this`.
interface JevBinding {
  run(
    model: typeof MODEL,
    input: { state: WorkspaceRuntimeValue; questions: Questions },
    options: { gateway: { id: string }; signal?: AbortSignal },
  ): Promise<{ answers: Answers }>;
}

/**
 * Host-side `ws:jev` module. Generated code calls
 * `call("classify", states, questions)` and gets back one Jev `answers`
 * object per state, in order. The model binding and gateway stay on
 * the host; the Dynamic Worker never sees them.
 */
export function createJevModule(ai: Ai, gatewayId: string): WorkspaceTrustedModule {
  const jev = ai as unknown as JevBinding;
  return {
    async call(method, args, context) {
      if (method !== "classify") throw new Error(`Unknown ws:jev method: ${method}`);
      const [states, questions] = args;
      if (!Array.isArray(states) || states.length > MAX_STATES) {
        throw new Error(`classify() takes an array of at most ${MAX_STATES} states.`);
      }
      if (questions === null || typeof questions !== "object" || Array.isArray(questions)) {
        throw new Error("classify() takes a questions object keyed by question name.");
      }

      const results: Answers[] = new Array(states.length);
      let next = 0;
      const worker = async () => {
        while (next < states.length) {
          const index = next++;
          const response = await jev.run(
            MODEL,
            { state: states[index], questions },
            { gateway: { id: gatewayId }, signal: context?.signal },
          );
          results[index] = response.answers;
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, states.length) }, worker));
      return results;
    },
  };
}
