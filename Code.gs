/**
 * Gmail Label Sorter (MVP)
 *
 * Moves inbox mail to category labels so the inbox stays empty.
 * It only ever does two things to a thread: add a label, then archive it.
 * It never deletes, trashes, marks as spam, sends or replies.
 *
 * Setup: paste into a project at script.google.com, edit RULES, run dryRun(),
 * read the log, then run sortInbox(). Run installTrigger() to sort hourly.
 */

var MAX_THREADS_PER_RULE = 100; // Gmail's batch limit, and a cap on one run's reach

/**
 * Rules are checked top to bottom. Put the categories you can't afford to
 * mislabel first: a thread is archived by the first rule that matches it.
 *   label: label to apply (created if missing; "Parent/Child" nests)
 *   query: a normal Gmail search, without "in:inbox"
 *   star:  also star the newest message, for mail you need to find fast
 *   action: also add the "@Action" label, for mail that needs a reply or a task
 */
var RULES = [
  { label: 'Security',      query: 'subject:("verification code" OR "security alert" OR "password reset")', star: true },
  { label: 'Finance',       query: 'from:(examplebank.com OR examplebroker.com)' },
  { label: 'Finance',       query: 'subject:("payment due" OR "statement is ready")', action: true },
  { label: 'Government',    query: 'from:(irs.gov OR ssa.gov)' },
  { label: 'Medical',       query: 'from:(examplehospital.org OR examplepharmacy.com)' },
  { label: 'Travel',        query: 'subject:("flight confirmation" OR itinerary OR "boarding pass")' },
  { label: 'Receipts',      query: 'subject:(receipt OR "order confirmation" OR invoice) -category:promotions' },
  { label: 'Work/Job-Search', query: 'from:(jobs-noreply@linkedin.com)' },
  { label: 'Social',        query: 'category:social' },
  { label: 'Newsletters',   query: 'from:(substack.com OR beehiiv.com)' },
  { label: 'Shopping',      query: 'category:promotions' }
];

var ACTION_LABEL = '@Action';

/** Shows what would happen. Changes nothing. Run this first. */
function dryRun() {
  run_(true);
}

/** Labels, then archives. Safe to run again: archived threads leave the inbox query. */
function sortInbox() {
  run_(false);
}

function run_(isDryRun) {
  var seen = {};
  var total = 0;
  RULES.forEach(function (rule) {
    var threads = GmailApp.search('in:inbox (' + rule.query + ')', 0, MAX_THREADS_PER_RULE)
      .filter(function (thread) {
        var id = thread.getId();
        if (seen[id]) return false; // an earlier rule already claimed it
        seen[id] = true;
        return true;
      });
    if (threads.length === 0) return;
    total += threads.length;

    if (isDryRun) {
      Logger.log('[dry run] %s <- %s threads, e.g. "%s"',
        rule.label, threads.length, threads[0].getFirstMessageSubject());
      return;
    }

    // Label first, archive second. If the script stops between the two,
    // the thread is labeled and still in the inbox, never archived unlabeled.
    getOrCreateLabel_(rule.label).addToThreads(threads);
    if (rule.action) getOrCreateLabel_(ACTION_LABEL).addToThreads(threads);
    if (rule.star) {
      threads.forEach(function (thread) {
        var messages = thread.getMessages();
        messages[messages.length - 1].star();
      });
    }
    GmailApp.moveThreadsToArchive(threads);
    Logger.log('%s <- %s threads', rule.label, threads.length);
  });
  Logger.log('%s%s threads matched. Unmatched mail stays in the inbox.',
    isDryRun ? '[dry run] ' : '', total);
}

/** Undo for one label: puts up to 100 of its threads back in the inbox. */
function moveLabelBackToInbox(labelName) {
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) throw new Error('No label named ' + labelName);
  var threads = label.getThreads(0, 100);
  if (threads.length) GmailApp.moveThreadsToInbox(threads);
  Logger.log('Moved %s threads from %s back to the inbox', threads.length, labelName);
}

/** Sort once an hour. Run this one time. */
function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('sortInbox').timeBased().everyHours(1).create();
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'sortInbox') ScriptApp.deleteTrigger(trigger);
  });
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
