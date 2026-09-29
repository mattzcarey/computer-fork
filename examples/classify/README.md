# classify example

> [!IMPORTANT]
> **PREVIEW ONLY** This package is provided as a preview for feedback only.
> APIs are unstable and the design is subject to change.

A Worker JavaScript backend that gives generated code a `classify`
function backed by [Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/)
(`typesafe/jev`), TypeSafe's structured decision model. An agent can
fetch a pile of emails, tickets, or records into the Workspace and
write a module that labels each one with Jev and then filters, sorts,
and counts the results with ordinary code.

```
generated module ──► import { classify } from "jev"
                          │
                          │  ws:jev (trusted module, host side)
                          ▼
                  env.AI.run("typesafe/jev", …, { gateway })
                          │
                          ▼
                     AI Gateway ──► Jev
```

The Dynamic Worker has no network access (`egress: { mode: "none" }`)
and never sees the AI binding. Its only way to the model is the
host-owned `ws:jev` module in [`src/jev.ts`](src/jev.ts), which calls
Jev once per item with up to eight calls in flight. Every call is
routed through the AI Gateway named by `AI_GATEWAY_ID` in
[`wrangler.jsonc`](wrangler.jsonc), so logs, caching, and rate
limits apply.

## The classify function

```js
import { classify } from "jev";

const answers = await classify(states, questions);
```

`states` is an array of up to 100 strings or JSON objects. `questions`
is a Jev questions object, and `answers[i]` is Jev's `answers` object
for `states[i]`. Jev supports three question types:

| Type | `criteria` | Answer |
|---|---|---|
| `noul` | `{ true, false }` descriptions | `{ noul }`, a probability from 0 to 1 |
| `choice` | `{ label: description }` | `{ choice, confidence, probabilities }` |
| `score` | Ordered list of levels | `{ score, confidence, legend, probabilities }` |

[`seed/triage.js`](seed/triage.js) drops promotional mail from an
inbox and sorts the rest by urgency:

```js
const answers = await classify(
  emails.map((e) => `From: ${e.from}\nSubject: ${e.subject}\n\n${e.body}`),
  {
    promotional: {
      type: "noul",
      instructions: "Is this marketing, a newsletter, or other bulk mail?",
      criteria: { true: "Bulk or promotional", false: "Written to the recipient" },
    },
    urgency: {
      type: "choice",
      instructions: "How soon does this need a reply?",
      criteria: { now: "Needs action today", later: "Can wait", none: "No reply needed" },
    },
  },
);
```

## Run it

The AI binding is always remote, so local development uses your
Cloudflare account and incurs Jev usage charges. AI Gateway creates
the `default` gateway on the first request; any other `AI_GATEWAY_ID`
must exist first.

```sh
npm run build --workspace @cloudflare/computer
npx wrangler login
npm run dev --workspace @example/computer-classify
```

Then, from `examples/classify`:

```sh
curl -X PUT --data-binary @seed/emails.json \
  http://127.0.0.1:8787/c/demo/file/workspace/emails.json

jq -n --rawfile source seed/triage.js '{ $source }' |
  curl -X POST http://127.0.0.1:8787/c/demo/exec \
    -H 'content-type: application/json' -d @- | jq .value
```

```json
[
  { "id": 3, "subject": "Prod is down", "urgency": "now" },
  { "id": 1, "subject": "Invoice 4821 overdue", "urgency": "now" },
  { "id": 5, "subject": "Lunch Friday?", "urgency": "later" }
]
```

## HTTP surface

```
PUT  /c/<name>/file/workspace/<path>   raw body → /workspace/<path>
POST /c/<name>/exec                    { source, input? } → run result JSON
```
