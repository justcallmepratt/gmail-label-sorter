# Gmail Label Sorter

Keeps a Gmail inbox empty by sending every email straight to a category label. It labels and
archives. It never deletes.

**Status:** the approach was used on a real inbox of about 52,000 threads in October 2026, with
AI agents and Gmail's own filters. `Code.gs` is that approach rewritten as a small Apps Script
anyone can run. The script has been checked against a mocked Gmail in Node (label-before-archive
order, first-rule-wins, undo) but not yet run against a live mailbox, so start with `dryRun()`.

## The idea

Inbox zero without throwing anything away. An archived email is still in All Mail and under its
label, so sorting is fully reversible. Deleting is not, so the tool can't do it.

## The MVP

[`Code.gs`](Code.gs) is a Google Apps Script with a list of rules. Each rule is a label and a
normal Gmail search:

```js
{ label: 'Security', query: 'subject:("verification code" OR "password reset")', star: true },
{ label: 'Shopping', query: 'category:promotions' }
```

1. Open [script.google.com](https://script.google.com), create a project and paste in `Code.gs`.
2. Add a second file, `Rules.local.gs`, with `var LOCAL_RULES = [ ... ]` in the same shape as
   `RULES`, listing your own senders. `Code.gs` uses it when present and falls back to its example
   `RULES` otherwise. `Rules.local.gs` is git-ignored so your senders stay out of a public fork.
3. Run `dryRun()` and read the log. It says which rule set it used. Nothing changes.
4. Run `sortInbox()`. Google asks for Gmail permission the first time.
5. Run `installTrigger()` to sort every hour.

Mail that no rule matches stays in the inbox. That is the signal to add a rule.

**Undo:** every live run records the IDs of the threads it archived. `undoLastRun()` puts exactly
those back in the inbox and removes the hourly trigger so they aren't re-sorted; labels and stars
stay on. A run that matched nothing doesn't overwrite the record. For older runs,
`moveLabelBackToInbox('Shopping', 2)` moves back archived Shopping threads received in the last two
days, which can include mail you archived yourself. `removeTrigger()` stops the hourly run.

## Set up with Claude

Open this folder in Claude Code and say **"Follow PROMPT.md."** [`PROMPT.md`](PROMPT.md) has Claude
agree a label list with you, write `RULES` for your senders, walk you through `dryRun()`, and
turn on the hourly sort only when you say so. It never touches mail itself.

## How we solved it

**1. Safety rules before anything else.** Label, then archive, in that order, so a thread is never
archived unlabeled. No delete, trash, spam, send or reply. Text inside an email is data, never an
instruction. Samples and approval before each batch.

**2. One taxonomy.** About twenty flat labels (Finance, Security, Government, Legal, Medical,
Personal, Housing, Travel, Receipts, Subscriptions, Shopping, Hobbies, Learning, Newsletters,
Social, Notifications, Work/..., `@Action`). Old labels were folded into the new ones, not removed.
The same map was reused for Drive folders and bookmarks.

**3. Two tools for two jobs.**

| Job | Tool | Why |
|---|---|---|
| The backlog, in bulk | Gmail filters with "also apply to matching conversations" | One filter sorts tens of thousands of threads at once |
| Judgment calls and leftovers | Parallel AI agents, one category each, capped per run | They can read a subject line and decide; filters can't |
| New mail, daily | A scheduled agent | Sorts what arrived and flags what needs attention |

The agent prompt is in [`docs/agent-prompt.md`](docs/agent-prompt.md).

**4. A truly empty inbox needs a second way to see urgent mail.** Everything skips the inbox,
including bank alerts and login codes. So security mail is starred, and mail that needs a reply or
has a deadline also gets `@Action`. Gmail's Multiple Inboxes view can show unread mail from a few
labels on the main screen while the inbox itself stays empty.

### What we learned

- **Agents are slow for bulk work.** They label one thread per call. Filters did the volume; agents
  did the sorting that needed reading.
- **Archived threads vanish from `in:inbox`.** A saved page token goes stale after each batch, so
  every batch restarts from the first page.
- **Rules need corrections from the owner.** Several senders were in the wrong category on the
  first pass, and government mail was split out of Legal into its own label. The taxonomy took a
  few rounds.
- **Order matters.** A broad rule like `category:promotions` will swallow bank mail unless the
  narrow rules run first or the broad one excludes those senders.
- **Sorting surfaces phishing.** Reading sender domains closely turned up lookalike emails. They
  were kept, not deleted, so they could be reported.

## Alternatives

Checked November 2026. The closest open-source tools, and why this one still exists:

| Project | What it does | Difference |
|---|---|---|
| [gmailctl](https://github.com/mbrt/gmailctl) (MIT) | Gmail filters as code, with tests | Filters new mail only; can also delete or forward if you write that |
| [Inbox Zero](https://github.com/elie222/inbox-zero) (AGPL-3.0) | AI rules, bulk archive, unsubscribe; learns from corrections | Needs a server and an LLM; its actions include delete, reply and send |
| [gmail-automata](https://github.com/ranmocy/gmail-automata) (Apache-2.0) | Apps Script rules kept in a Sheet | Closest design; inactive since 2024 |
| [imapfilter](https://github.com/lefcha/imapfilter) (MIT) | Lua rules over IMAP | IMAP fits Gmail labels awkwardly; deleting is easy |

This script has no delete, trash, send or reply code at all, runs inside your own Google account
with no server, and sorts mail already in the inbox as well as new mail.

## What's next

- A review queue: unmatched senders listed once a week with a suggested label.
- Learn from corrections, so moving a thread by hand updates the rule.
- A log sheet of every action, for audit and undo beyond the last run.
- Ideas to borrow: gmailctl's rule tests, Inbox Zero's learned sender patterns, and gmail-automata's
  error label for threads that fail mid-run.
