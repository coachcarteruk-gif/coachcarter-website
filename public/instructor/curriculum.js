(function () {
  'use strict';

  var DRAFT_KEY = 'cc_curriculum_topic_draft';
  var topics = [];
  var actor = null;
  var searchInput = document.getElementById('topicSearch');
  var clearSearchButton = document.getElementById('clearTopicSearch');
  var topicResults = document.getElementById('topicResults');
  var recentTopics = document.getElementById('recentTopics');
  var recentSection = document.getElementById('recentSection');
  var topicCount = document.getElementById('topicCount');
  var continueSection = document.getElementById('continueSection');
  var continueTopic = document.getElementById('continueTopic');
  var reviewSection = document.getElementById('suggestionReviewSection');
  var reviewList = document.getElementById('suggestionReviewList');
  var suggestionCount = document.getElementById('suggestionCount');
  var statusNode = document.getElementById('curriculumStatus');
  var sheetBackdrop = document.getElementById('topicSheetBackdrop');
  var topicForm = document.getElementById('topicForm');
  var topicName = document.getElementById('newTopicName');
  var topicDescription = document.getElementById('newTopicDescription');
  var topicMatches = document.getElementById('topicMatches');
  var topicFormError = document.getElementById('topicFormError');
  var createTopicButton = document.getElementById('createTopicButton');
  var toastTimer = null;
  var sheetReturnFocus = null;

  function svg(paths) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    paths.forEach(function (item) {
      var shape = document.createElementNS('http://www.w3.org/2000/svg', item.name || 'path');
      Object.keys(item).forEach(function (key) {
        if (key !== 'name') shape.setAttribute(key, item[key]);
      });
      node.appendChild(shape);
    });
    return node;
  }

  function chevronIcon() {
    return svg([{ name: 'polyline', points: '9 18 15 12 9 6' }]);
  }

  function messageIcon() {
    return svg([{ d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]);
  }

  function readJson(response) {
    return response.json().catch(function () { return {}; });
  }

  function showToast(message) {
    statusNode.textContent = message;
    statusNode.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      statusNode.classList.remove('is-visible');
    }, 4200);
  }

  function formatActivity(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    var diff = Date.now() - date.getTime();
    var day = 86400000;
    if (diff >= 0 && diff < day) return 'Active today';
    if (diff >= day && diff < day * 2) return 'Active yesterday';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short'
    }).format(date);
  }

  function topicHref(topic) {
    return '/instructor/curriculum-topic?id=' + encodeURIComponent(topic.id);
  }

  function createMeta(topic) {
    var meta = document.createElement('div');
    meta.className = 'curriculum-card-meta';

    var conversations = document.createElement('span');
    conversations.appendChild(messageIcon());
    conversations.appendChild(document.createTextNode(
      Number(topic.contribution_count || 0) === 1
        ? '1 contribution'
        : Number(topic.contribution_count || 0) + ' contributions'
    ));
    meta.appendChild(conversations);

    var activity = formatActivity(topic.last_activity_at || topic.updated_at);
    if (activity) {
      var active = document.createElement('span');
      active.textContent = activity;
      meta.appendChild(active);
    }
    return meta;
  }

  function createTopicCard(topic) {
    var link = document.createElement('a');
    link.className = 'curriculum-topic-card';
    link.href = topicHref(topic);

    var title = document.createElement('h3');
    title.textContent = topic.name;
    var copy = document.createElement('p');
    copy.textContent = topic.description || 'Open this workspace to explore and add teaching ideas.';

    link.appendChild(title);
    link.appendChild(copy);
    link.appendChild(createMeta(topic));
    return link;
  }

  function createTopicRow(topic, isSubtopic) {
    var link = document.createElement('a');
    link.className = 'curriculum-topic-row' + (isSubtopic ? ' curriculum-topic-row--subtopic' : '');
    link.href = topicHref(topic);

    var content = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = topic.name;
    var copy = document.createElement('p');
    var facts = [];
    if (topic.parent_name) facts.push('Under ' + topic.parent_name);
    if (Number(topic.subtopic_count || 0)) {
      facts.push(topic.subtopic_count + (Number(topic.subtopic_count) === 1 ? ' subtopic' : ' subtopics'));
    }
    facts.push(Number(topic.contribution_count || 0) + (Number(topic.contribution_count) === 1 ? ' contribution' : ' contributions'));
    copy.textContent = facts.join(' · ');

    content.appendChild(title);
    content.appendChild(copy);
    link.appendChild(content);
    link.appendChild(chevronIcon());
    return link;
  }

  function createEmpty(title, copy) {
    var empty = document.createElement('div');
    empty.className = 'curriculum-empty';
    var strong = document.createElement('strong');
    strong.textContent = title;
    var paragraph = document.createElement('span');
    paragraph.textContent = copy;
    empty.appendChild(strong);
    empty.appendChild(paragraph);
    return empty;
  }

  function filteredTopics() {
    var query = searchInput.value.trim().toLocaleLowerCase('en-GB');
    if (!query) return topics.slice();
    var terms = query.split(/\s+/).filter(Boolean);
    return topics.filter(function (topic) {
      var haystack = [
        topic.name,
        topic.description,
        topic.parent_name
      ].join(' ').toLocaleLowerCase('en-GB');
      return terms.every(function (term) { return haystack.indexOf(term) !== -1; });
    });
  }

  function renderTopics() {
    var visible = filteredTopics();
    var query = searchInput.value.trim();
    clearSearchButton.hidden = !query;
    topicCount.textContent = visible.length === 1 ? '1 topic' : visible.length + ' topics';

    if (!visible.length) {
      topicResults.replaceChildren(createEmpty(
        'No matching topics',
        'Try a broader search, or add this as a new topic if it is not already covered.'
      ));
      topicResults.setAttribute('aria-busy', 'false');
      recentSection.hidden = !!query;
      return;
    }

    var visibleIds = new Set(visible.map(function (topic) { return String(topic.id); }));
    var roots = visible.filter(function (topic) {
      return !topic.parent_topic_id || !visibleIds.has(String(topic.parent_topic_id));
    });
    var children = new Map();
    visible.forEach(function (topic) {
      if (!topic.parent_topic_id) return;
      var key = String(topic.parent_topic_id);
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(topic);
    });

    var fragment = document.createDocumentFragment();
    roots.forEach(function (root) {
      fragment.appendChild(createTopicRow(root, !!root.parent_topic_id));
      (children.get(String(root.id)) || []).forEach(function (child) {
        fragment.appendChild(createTopicRow(child, true));
      });
    });
    topicResults.replaceChildren(fragment);
    topicResults.setAttribute('aria-busy', 'false');
    recentSection.hidden = !!query;
  }

  function renderRecent() {
    var sorted = topics.slice().sort(function (a, b) {
      return new Date(b.last_activity_at || b.updated_at) - new Date(a.last_activity_at || a.updated_at);
    }).slice(0, 5);
    if (!sorted.length) {
      recentTopics.replaceChildren(createEmpty('No activity yet', 'Open a topic and start the first conversation.'));
    } else {
      var fragment = document.createDocumentFragment();
      sorted.forEach(function (topic) { fragment.appendChild(createTopicCard(topic)); });
      recentTopics.replaceChildren(fragment);
    }
    recentTopics.setAttribute('aria-busy', 'false');
  }

  function renderContinue() {
    var lastId = localStorage.getItem('cc_curriculum_last_topic_id');
    if (!lastId) {
      continueSection.hidden = true;
      return;
    }
    var topic = topics.find(function (item) { return String(item.id) === String(lastId); });
    if (!topic) {
      continueSection.hidden = true;
      return;
    }
    var link = document.createElement('a');
    link.className = 'curriculum-continue-card';
    link.href = topicHref(topic);
    var content = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = topic.name;
    var copy = document.createElement('p');
    copy.textContent = 'Return to this topic workspace.';
    content.appendChild(title);
    content.appendChild(copy);
    link.appendChild(content);
    link.appendChild(chevronIcon());
    continueTopic.replaceChildren(link);
    continueSection.hidden = false;
  }

  function suggestionTitle(suggestion) {
    var labels = {
      rename: 'Rename suggested',
      move: 'Move suggested',
      archive: 'Archive suggested',
      merge: 'Possible duplicate',
      connection: 'Connection suggested',
      other: 'Structural suggestion'
    };
    return labels[suggestion.suggestion_type] || 'Structural suggestion';
  }

  function renderSuggestions(suggestions) {
    if (!actor || !actor.is_admin || !suggestions.length) {
      reviewSection.hidden = true;
      return;
    }
    var fragment = document.createDocumentFragment();
    suggestions.forEach(function (suggestion) {
      var card = document.createElement('article');
      card.className = 'curriculum-suggestion-card';
      card.dataset.suggestionId = String(suggestion.id);

      var title = document.createElement('h3');
      title.textContent = suggestionTitle(suggestion) + ': ' + suggestion.topic_name;
      var copy = document.createElement('p');
      copy.textContent = suggestion.details;
      var author = document.createElement('p');
      author.textContent = 'Suggested by ' + suggestion.author_name;

      var actions = document.createElement('div');
      actions.className = 'curriculum-suggestion-actions';
      ['accepted', 'rejected'].forEach(function (status) {
        var button = document.createElement('button');
        button.type = 'button';
        button.dataset.reviewStatus = status;
        button.dataset.suggestionId = String(suggestion.id);
        button.textContent = status === 'accepted' ? 'Accept' : 'Reject';
        actions.appendChild(button);
      });

      card.appendChild(title);
      card.appendChild(copy);
      card.appendChild(author);
      card.appendChild(actions);
      fragment.appendChild(card);
    });
    suggestionCount.textContent = suggestions.length + ' pending';
    reviewList.replaceChildren(fragment);
    reviewSection.hidden = false;
  }

  function matchingTopics(value) {
    var query = value.trim().toLocaleLowerCase('en-GB');
    if (query.length < 2) return [];
    var terms = query.split(/\s+/).filter(Boolean);
    return topics.filter(function (topic) {
      var name = topic.name.toLocaleLowerCase('en-GB');
      return name.indexOf(query) !== -1
        || query.indexOf(name) !== -1
        || terms.some(function (term) { return name.indexOf(term) !== -1; });
    }).slice(0, 5);
  }

  function renderMatches() {
    var matches = matchingTopics(topicName.value);
    if (!matches.length) {
      topicMatches.replaceChildren();
      return;
    }
    var fragment = document.createDocumentFragment();
    var heading = document.createElement('p');
    heading.className = 'curriculum-match-heading';
    heading.textContent = 'Could one of these already cover it?';
    fragment.appendChild(heading);
    matches.forEach(function (topic) {
      var link = document.createElement('a');
      link.className = 'curriculum-match';
      link.href = topicHref(topic);
      var name = document.createElement('span');
      name.textContent = topic.name;
      link.appendChild(name);
      link.appendChild(chevronIcon());
      fragment.appendChild(link);
    });
    topicMatches.replaceChildren(fragment);
  }

  function saveDraft() {
    var draft = {
      name: topicName.value,
      description: topicDescription.value,
      updated_at: new Date().toISOString()
    };
    if (draft.name || draft.description) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  function restoreDraft() {
    try {
      var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      topicName.value = draft.name || '';
      topicDescription.value = draft.description || '';
      renderMatches();
    } catch (_) {
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  function trapSheetFocus(event) {
    var focusable = Array.from(sheetBackdrop.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
    )).filter(function (node) {
      return node.getClientRects().length > 0;
    });
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !sheetBackdrop.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openSheet() {
    topicFormError.textContent = '';
    sheetReturnFocus = document.activeElement;
    sheetBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    restoreDraft();
    setTimeout(function () { topicName.focus(); }, 30);
  }

  function closeSheet() {
    saveDraft();
    sheetBackdrop.hidden = true;
    document.body.style.overflow = '';
    if (sheetReturnFocus && typeof sheetReturnFocus.focus === 'function') sheetReturnFocus.focus();
    sheetReturnFocus = null;
  }

  async function createTopic(event) {
    event.preventDefault();
    var name = topicName.value.trim();
    if (!name) {
      topicFormError.textContent = 'Enter a topic name.';
      topicName.focus();
      return;
    }
    topicFormError.textContent = '';
    createTopicButton.disabled = true;
    createTopicButton.textContent = 'Creating...';
    try {
      var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=create-topic', {
        method: 'POST',
        body: JSON.stringify({
          name: name,
          description: topicDescription.value.trim()
        })
      });
      var data = await readJson(response);
      if (!response.ok || !data.ok || !data.topic) {
        throw new Error(data.message || 'The topic could not be created.');
      }
      localStorage.removeItem(DRAFT_KEY);
      window.location.href = topicHref(data.topic);
    } catch (error) {
      topicFormError.textContent = error.message;
      topicName.focus();
    } finally {
      createTopicButton.disabled = false;
      createTopicButton.textContent = 'Create topic';
    }
  }

  async function reviewSuggestion(button) {
    var status = button.dataset.reviewStatus;
    var suggestionId = button.dataset.suggestionId;
    button.disabled = true;
    try {
      var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=review-suggestion', {
        method: 'POST',
        body: JSON.stringify({
          suggestion_id: Number(suggestionId),
          status: status
        })
      });
      var data = await readJson(response);
      if (!response.ok || !data.ok) throw new Error(data.message || 'The suggestion could not be reviewed.');
      var card = reviewList.querySelector('[data-suggestion-id="' + suggestionId + '"]');
      if (card) card.remove();
      var remaining = reviewList.querySelectorAll('.curriculum-suggestion-card').length;
      suggestionCount.textContent = remaining + ' pending';
      if (!remaining) reviewSection.hidden = true;
      showToast(status === 'accepted' ? 'Suggestion accepted.' : 'Suggestion rejected.');
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }

  async function loadCurriculum() {
    try {
      var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=bootstrap');
      var data = await readJson(response);
      if (response.status === 401) {
        window.location.href = window.ccCurriculumAuth.loginUrl();
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.message || 'Curriculum could not be loaded.');
      actor = data.actor;
      topics = Array.isArray(data.topics) ? data.topics : [];
      renderContinue();
      renderRecent();
      renderTopics();
      renderSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch (error) {
      topicResults.replaceChildren(createEmpty('Curriculum is unavailable', error.message));
      topicResults.setAttribute('aria-busy', 'false');
      recentSection.hidden = true;
    }
  }

  searchInput.addEventListener('input', renderTopics);
  clearSearchButton.addEventListener('click', function () {
    searchInput.value = '';
    renderTopics();
    searchInput.focus();
  });
  topicName.addEventListener('input', function () {
    renderMatches();
    saveDraft();
  });
  topicDescription.addEventListener('input', saveDraft);
  topicForm.addEventListener('submit', createTopic);

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-open-sheet="topic"]')) openSheet();
    if (event.target.closest('[data-close-sheet]')) closeSheet();
    var reviewButton = event.target.closest('[data-review-status]');
    if (reviewButton) reviewSuggestion(reviewButton);
  });
  sheetBackdrop.addEventListener('click', function (event) {
    if (event.target === sheetBackdrop) closeSheet();
  });
  document.addEventListener('keydown', function (event) {
    if (sheetBackdrop.hidden) return;
    if (event.key === 'Escape') closeSheet();
    else if (event.key === 'Tab') trapSheetFocus(event);
  });

  loadCurriculum();
})();
