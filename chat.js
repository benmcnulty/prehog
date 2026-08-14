/**
 * public/prehog/chat.js
 *
 * "Ask about PostHog fit" — a toggleable, reskinned instance of the
 * shared AI Lab chat foundation (see docs/CHAT_ARCHITECTURE.md in the
 * benlive repo), scoped to this deck's own content via the
 * `prehog.chat.v1` server prompt. This file is the only prehog-specific
 * chat code; everything else (transport, retry policy, error
 * classification, message rendering) is the exact same shared module
 * every AI Lab chat app uses — reused, not forked.
 *
 * No tier switcher: a single fixed model (Thoughtful tier's), so there's
 * no `chat-config.js`-driven storage/persistence needed here beyond
 * reading the one model id from the canonical table.
 *
 * Panel open/close reuses prehog.js's own modal pair via
 * window.__prehogPanelModal (see prehog.js) rather than a bespoke
 * implementation, per AGENTS.md's shared-pair requirement for any new
 * dialog-role panel. Analytics are dispatched as plain DOM CustomEvents
 * (window.__prehogEvents / 'prehog:*'), the same generic mechanism
 * prehog.js itself uses — this file knows nothing about PostHog, and
 * deliberately never puts chat message text into any event detail.
 */
(function () {
  'use strict';

  var panel = document.querySelector('[data-chat-panel]');
  if (!panel) return; // markup absent — nothing to wire up

  var openBtn = document.querySelector('[data-action="open-chat"]');
  var closeTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-chat-close]'));
  var startersEl = panel.querySelector('[data-chat-starters]');
  var starterButtons = Array.prototype.slice.call(panel.querySelectorAll('[data-starter]'));
  var messagesEl = panel.querySelector('[data-chat-messages]');
  var form = panel.querySelector('[data-chat-form]');
  var input = panel.querySelector('[data-chat-input]');
  var sendBtn = panel.querySelector('[data-chat-send]');
  var resetBtn = panel.querySelector('[data-chat-reset]');

  var STARTER_QUESTIONS = {
    culture: 'What does "context, not control" mean here?',
    throughline: "What's the throughline across Ben's work?",
    analytics: 'Why build this page\'s analytics this way?',
    'why-now': 'Why this role, why now?'
  };

  var CONVERSATION_INITIATED_KEY = 'bl:prehog-chat-initiated';
  var conversationInitiated = (function () {
    try { return sessionStorage.getItem(CONVERSATION_INITIATED_KEY) === '1'; } catch (e) { return false; }
  })();

  // Mirrors prehog.js's own emit() exactly (buffer + dispatch) — kept
  // local rather than importing across files since prehog.js's version
  // is a private closure, and this is five lines. prehog.js "knows
  // nothing about PostHog"; so does this: these are generic DOM events,
  // and analytics.js decides what (if anything) becomes a PostHog call.
  window.__prehogEvents = window.__prehogEvents || [];
  function emit(name, detail) {
    var payload = detail || {};
    window.__prehogEvents.push({ name: name, detail: payload });
    document.dispatchEvent(new CustomEvent(name, { detail: payload }));
  }

  var client = new window.OpenRouterClient({
    model: window.BenLiveChatConfig.TIER_DEFAULTS.thoughtful.openrouter
  });
  // Reassigned (not just .clear()'d) on reset — see the reset handler
  // below for why: an in-flight send() holds a closure over the OLD
  // conversation's own `history` array, and that array gets mutated
  // internally by openrouter-client.js regardless of what happens in
  // this file, so merely emptying it out from here doesn't stop a
  // stale completion from pushing a stray assistant entry onto it.
  var conversation = client.createConversation('prehog.chat.v1');

  var transcript = window.BenLiveChatTranscript.create({
    messagesEl: messagesEl,
    markdownParser: window.MarkdownParser, // static .parse(), matches ai-lab/chat's usage
    iconSprite: '/img/icons/ai-lab-icons.svg',
    // Fixed, non-switching identity — there's no tier selector here, so
    // there's nothing per-message to attribute beyond "this assistant."
    getActiveTierIcon: function () { return ''; },
    getActiveModelLabel: function () { return 'PostHog Fit AI'; },
    // prehog.chat.v1 (functions/index.js) explicitly instructs the model
    // not to expose internal reasoning or hidden-thought exposition —
    // rendering a "View thinking process" control for this instance
    // would contradict that domain contract even though the underlying
    // Thoughtful-tier model can return reasoning_details. Chat/Promptpad
    // show reasoning because their prompts don't carry this constraint;
    // this instance's prompt does.
    enableReasoning: false,
    onResubmit: function (text) {
      input.value = text;
      sendMessage(text);
    },
    // Local UI bookkeeping only — never analytics. The resubmit_clicked
    // event this hook also fires carries the message text; that must
    // never be forwarded to emit()/capture(), which is why this handler
    // does nothing with it.
    onEvent: function () {}
  });

  var lastFocused = null;
  var pendingSend = false;
  var activeTypingId = null;
  // Bumped on every reset. A send() captures the generation it started
  // with; if reset runs before that request settles, the generation it
  // captured no longer matches, and its .then()/.catch()/.finally() all
  // no-op instead of rendering a response into (or re-enabling input
  // for) a conversation the visitor already cleared.
  var generation = 0;

  function openChat() {
    if (!panel.hidden) return;
    if (window.__prehogPanelModal && window.__prehogPanelModal.pauseAutoplay) {
      window.__prehogPanelModal.pauseAutoplay('manual');
    }
    lastFocused = window.__prehogPanelModal.open(panel);
    emit('prehog:chatopened', {});
  }

  function closeChat() {
    window.__prehogPanelModal.close(panel, lastFocused);
  }

  if (openBtn) openBtn.addEventListener('click', openChat);
  closeTriggers.forEach(function (btn) { btn.addEventListener('click', closeChat); });
  // Bridge for prehog.js's centralized Escape-key handler — mirrors the
  // existing window.__prehogOpenSurvey cross-file hook, just for close.
  window.__prehogCloseChat = closeChat;

  function hideStarters() {
    if (startersEl) startersEl.hidden = true;
  }

  starterButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-starter');
      var question = STARTER_QUESTIONS[key];
      if (!question) return;
      emit('prehog:chatstarterselected', { starter: key });
      sendMessage(question);
    });
  });

  function setLoading(isLoading) {
    pendingSend = isLoading;
    if (sendBtn) sendBtn.disabled = isLoading;
    if (input) input.disabled = isLoading;
  }

  function sendMessage(text) {
    var trimmed = (text || '').trim();
    if (!trimmed || pendingSend) return;

    hideStarters();
    transcript.addMessage('user', trimmed);
    input.value = '';
    setLoading(true);

    if (!conversationInitiated) {
      conversationInitiated = true;
      try { sessionStorage.setItem(CONVERSATION_INITIATED_KEY, '1'); } catch (e) { /* ignore */ }
      emit('prehog:chatmessagesent', {});
    }

    var requestGeneration = generation;
    var typingId = transcript.addTyping();
    activeTypingId = typingId;

    conversation.send(trimmed, {
      promptKey: 'prehog.chat.v1',
      maxRetries: 1,
      retryDelay: 2000
    }).then(function (result) {
      if (requestGeneration !== generation) return; // reset happened while this was in flight
      transcript.removeTyping(typingId);
      activeTypingId = null;
      transcript.addMessage('assistant', result.content, result.reasoningDetails);
    }).catch(function (error) {
      if (requestGeneration !== generation) return;
      transcript.removeTyping(typingId);
      activeTypingId = null;
      var classified = window.BenLiveChatErrors.classifyError(error);
      transcript.addMessage('assistant', classified.message, null, {
        isError: true,
        retryText: trimmed
      });
    }).finally(function () {
      if (requestGeneration !== generation) return; // don't re-enable input for a stale, already-reset request
      setLoading(false);
      if (!('ontouchstart' in window)) input.focus();
    });
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendMessage(input.value);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      generation += 1; // invalidates any in-flight send()'s completion handlers
      // A fresh conversation object, not conversation.clear() — clear()
      // would empty the OLD object's `history` array in place, but a
      // still-in-flight request already holds a closure over that same
      // array and will push its own late completion onto it regardless
      // of this handler (see openrouter-client.js's send()). Handing out
      // a brand new object means that late push lands on a history no
      // longer referenced by anything, instead of corrupting the
      // conversation the visitor just asked to start over.
      conversation = client.createConversation('prehog.chat.v1');
      if (activeTypingId) {
        transcript.removeTyping(activeTypingId);
        activeTypingId = null;
      }
      setLoading(false);
      messagesEl.innerHTML = '';
      if (startersEl) startersEl.hidden = false;
      emit('prehog:chatreset', {});
    });
  }
})();
