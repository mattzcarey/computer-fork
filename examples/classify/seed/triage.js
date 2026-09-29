import { readFile } from "node:fs/promises";
import { classify } from "jev";

export default async () => {
  const emails = JSON.parse(await readFile("/workspace/emails.json", "utf8"));
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
  return emails
    .map((e, i) => ({ id: e.id, subject: e.subject, ...answers[i] }))
    .filter((e) => e.promotional.noul < 0.5)
    .sort((a, b) => b.urgency.probabilities.now - a.urgency.probabilities.now)
    .map((e) => ({ id: e.id, subject: e.subject, urgency: e.urgency.choice }));
};
