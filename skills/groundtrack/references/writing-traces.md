# Writing a trace

A trace is a list of moves you write by hand. Read
[`flightpath-file.md`](flightpath-file.md) for the field shape. This page is
about getting a trace right, and about the two mistakes that measurement says
you will actually make.

## The loop

Write the file. Run the validator. Read the refusal. Fix it. Run it again.

```bash
node <skill>/scripts/render.mjs <topic>.flightpath.json --check
```

Refusals go to standard error and the exit code is 1. Findings go to standard
output and the exit code stays 0. A refusal names the file and a reason,
always. When the fault is in a trace it names the run and the move as well.

**The loop ends on a clean checker, and a clean checker still prints findings.**
The loop never fixes them, because a finding never refuses. Read every finding
when the loop ends, and answer each one before you call the file done.

**Do not write the whole file and then validate once.** Write the graph, run
the validator, and only then write the first trace. A trace written against a
graph that does not hold is a trace you will rewrite.

Measured on a weak agent over nine runs: with the validator in hand, eight in
nine reach a clean checker, in a median of two passes and a worst case of
three. Without it, four in nine were legal on the first attempt and nobody
found out which four.

## Follow the code, not the diagram

Open the material and follow one route through it, move by move. Write the move
as you pass it. Do not write the shape you expect and then look for it.

A trace written from a remembered shape drifts at the first branch, and the
drift is silent until a `next` lands somewhere the step cannot reach — often
four moves later, where the refusal is harder to read.

## The cursor is a fact, not an inference

- Every move that runs a step carries `at`, and `at` is where the cursor
  already sits.
- Every move that leaves a live cursor carries `next`, and `next` is where the
  cursor goes.
- Nothing advances on its own.

The one place this trips people is the call. **A call sets its own `next`
before the callee is pushed**, so while the callee runs, the caller's cursor is
already past the call step. Write the caller's continuation on the call move,
then push.

## A failure is one move

An effect that failed carries `raised` and no `next`. No second move
follows to throw it. If you catch yourself writing two moves for one failure,
the shape has already told you it only wants one.

Then decide which kind of failure it is:

- **The effect throws.** The effect move carries `raised`. A `propagate`
  follows for each frame the error leaves. Then comes either an `uncaught`, or
  a `catch` in a frame whose call step declares that tag.
- **The effect returns a failure value the code inspects.** The effect move
  carries `next` to the `if` that inspects it, and the `if` routes to the
  `throw` step.

Both are ordinary. Pick the one the real code does.

**Give the error its cause.** Write `fail` for an error the node's `error`
list names. Write `die` for a defect the list does not name. Every `throw` move
and the `uncaught` move repeat the cause the error carries.

## The two things measurement says you will get wrong

### One: a spurious pop

A `return` or a `propagate` you did not mean empties the frame stack, and every
move after it is refused. One measured run went 34 errors, then 36, then 36,
then 36, and finished blaming the checker — when the whole fault was one
`propagate` a single move earlier than the refusal pointed.

The validator now names **the move that emptied the stack**, not the first move
to notice. When you see that refusal, look at the move it names and nowhere
else.

### Two: a handler the program has not got

This is the one the validator cannot see, and it is the residual the
measurement ends on. A declared-but-unused `onError` is a perfectly legal path.
No refusal will ever mention it. So a file can be green and describe a program
that does not exist.

One check does fire on the strongest form of it: **a tag claimed uncaught is
refused when a frame in its way declares a handler for that tag.** That moves
the error into the half the loop demonstrably fixes.

The rest is on you. Before you call the file done:

- Read every `onError` you wrote and find the line in the material that catches
  that tag. If there is no such line, delete the handler.
- Read every `error` list and find what throws each tag.
- Read every `role` and check the node does what the word says. A node marked
  pure that runs an effect is a claim the page prints and nothing tests.

## Provenance is not decoration

`authored` means a person or an agent wrote this trace from reading the
material. `captured` means a real run produced it. **Write `authored` unless a
run produced it.** The page stamps the two differently on purpose, because an
authored trace is a longer claim and not a check.

No recorder ships, so today every trace you write is `authored`.

## What a good trace shows

One route, chosen because it shows something. A file with five runs that all
take the happy path is a file whose run picker changes nothing.

Give each run a `blurb` of one sentence saying what it shows. A reader chooses
between runs on that sentence alone, and the text output lists every run you
did not print by name and blurb.
