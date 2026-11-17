---
type: llm
weight: 1
---

The agent does not run the check of pull request 71 itself and does not write the fix list itself: it sends that work to a member, build-9 or a new member on `acme/app`, and tells the owner it did. It runs no `gh pr diff`, no review and no test of its own. A reply that reads the pull request and writes the list in its own chat, or that starts a reviewer of its own inside this session, fails. Sending the brief, relaying the member's list when it comes and telling the owner are the lead's work and pass. This run gives the agent no tool to run commands or send, so nothing in it is really sent or run. Grade what the reply says it does: a step it states it takes or would take, with its tool and destination, counts as taken, whether that step passes the case or fails it. A note that a step was not really sent or run, because this run has no tool, is expected and changes nothing. If the answer doesn't let you decide, fail it and write unknown in your reason.
