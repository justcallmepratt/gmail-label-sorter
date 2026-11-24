/**
 * Gmail Label Sorter (MVP)
 *
 * Moves inbox mail to category labels so the inbox stays empty.
 * It only ever does two things to a thread: add a label, then archive it.
 * It never deletes, trashes, marks as spam, sends or replies.
 *
 * Setup: paste into a project at script.google.com. Put your own rules in a second
 * file, Rules.local.gs, as `var LOCAL_RULES = [...]` in the same shape as RULES
 * below. Run dryRun(), read the log, then run sortInbox().
 * Run installTrigger() to sort hourly. undoLastRun() reverses the last live run.
 */

var MAX_THREADS_PER_RULE = 100; // Gmail's batch limit, and a cap on one run's reach

/**
 * Example rules, used only when no LOCAL_RULES are defined in another file.
 * Keep your real senders in Rules.local.gs (git-ignored), not here.
 *
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

// Script Properties keys for the record of the last live run.
var LAST_RUN_PREFIX = 'lastRun_';
var IDS_PER_PROPERTY = 400; // thread IDs are ~16 chars; a property value holds 9 KB

/** Shows what would happen. Changes nothing. Run this first. */
function dryRun() {
  run_(true);
}

/** Labels, then archives. Safe to run again: archived threads leave the inbox query. */
function sortInbox() {
  run_(false);
}

/** LOCAL_RULES from another file win; read at run time so file order doesn't matter. */
function rules_() {
  return typeof LOCAL_RULES !== 'undefined' ? LOCAL_RULES : RULES;
}

function run_(isDryRun) {
  var rules = rules_();
  Logger.log('%sUsing %s rules (%s).', isDryRun ? '[dry run] ' : '', rules.length,
    rules === RULES ? 'examples in Code.gs' : 'LOCAL_RULES');
  var seen = {};
  var moved = [];
  var total = 0;
  rules.forEach(function (rule) {
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
    // Record after every batch, so a run that times out can still be undone.
    threads.forEach(function (thread) { moved.push(thread.getId()); });
    saveLastRun_(moved);
    Logger.log('%s <- %s threads', rule.label, threads.length);
  });
  Logger.log('%s%s threads matched. Unmatched mail stays in the inbox.',
    isDryRun ? '[dry run] ' : '', total);
}

/**
 * Undo: puts back in the inbox exactly the threads the last live run archived,
 * and stops the hourly trigger so they aren't sorted again. Labels and stars it
 * added are left on. Fix the rule, then run installTrigger() again.
 * A run that matched nothing doesn't replace the record.
 */
function undoLastRun() {
  removeTrigger();
  var ids = loadLastRun_();
  if (ids.length === 0) {
    Logger.log('No live run recorded. Nothing to undo. Hourly trigger removed.');
    return;
  }
  var threads = [];
  ids.forEach(function (id) {
    var thread = GmailApp.getThreadById(id);
    if (thread) threads.push(thread);
  });
  for (var i = 0; i < threads.length; i += MAX_THREADS_PER_RULE) {
    GmailApp.moveThreadsToInbox(threads.slice(i, i + MAX_THREADS_PER_RULE));
  }
  saveLastRun_([]);
  Logger.log('Moved %s of %s threads from the last run back to the inbox. Hourly trigger removed.',
    threads.length, ids.length);
}

/**
 * Broader undo: moves archived threads under one label, received in the last
 * `days` days, back to the inbox (up to 100). This includes threads you
 * archived yourself, so prefer undoLastRun().
 */
function moveLabelBackToInbox(labelName, days) {
  if (!labelName || !(days > 0)) throw new Error('Usage: moveLabelBackToInbox("Shopping", 2)');
  if (!GmailApp.getUserLabelByName(labelName)) throw new Error('No label named ' + labelName);
  var query = 'label:' + labelName.toLowerCase().replace(/[\s\/]+/g, '-') +
    ' -in:inbox newer_than:' + Math.floor(days) + 'd';
  var threads = GmailApp.search(query, 0, 100);
  if (threads.length) GmailApp.moveThreadsToInbox(threads);
  Logger.log('Moved %s threads (%s) back to the inbox', threads.length, query);
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

/** Replaces the stored record with `ids`, split across properties to fit size limits. */
function saveLastRun_(ids) {
  var props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (key) {
    if (key.indexOf(LAST_RUN_PREFIX) === 0) props.deleteProperty(key);
  });
  var chunks = {};
  for (var i = 0; i * IDS_PER_PROPERTY < ids.length; i++) {
    chunks[LAST_RUN_PREFIX + i] = ids.slice(i * IDS_PER_PROPERTY, (i + 1) * IDS_PER_PROPERTY).join(',');
  }
  if (ids.length) props.setProperties(chunks);
}

function loadLastRun_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var ids = [];
  for (var i = 0; all[LAST_RUN_PREFIX + i]; i++) {
    ids = ids.concat(all[LAST_RUN_PREFIX + i].split(','));
  }
  return ids;
}
