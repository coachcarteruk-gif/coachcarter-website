(function () {
  'use strict';

  var RESPONSE_LABELS = {
    build_on: 'Build on this',
    alternative: 'Offer an alternative perspective',
    example: 'Add an example',
    question: 'Ask a question',
    connect_topic: 'Connect another topic'
  };
  var SUGGESTION_LABELS = {
    rename: 'Suggest a clearer name',
    move: 'Suggest moving this topic',
    archive: 'Suggest archiving this topic',
    merge: 'Flag a possible duplicate',
    connection: 'Suggest a connection',
    other: 'Something else'
  };

  var params = new URLSearchParams(window.location.search);
  var topicId = Number.parseInt(params.get('id'), 10);
  var workspace = document.getElementById('topicWorkspace');
  var sheetBackdrop = document.getElementById('workspaceSheetBackdrop');
  var sheetBody = document.getElementById('workspaceSheetBody');
  var sheetTitle = document.getElementById('workspaceSheetTitle');
  var sheetEyebrow = document.getElementById('workspaceSheetEyebrow');
  var mobileAddButton = document.getElementById('mobileAddInput');
  var statusNode = document.getElementById('curriculumStatus');
  var topic = null;
  var prompts = [];
  var contributions = [];
  var subtopics = [];
  var connections = [];
  var allTopics = [];
  var actor = null;
  var activeDraftKey = null;
  var toastTimer = null;
  var sheetReturnFocus = null;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

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

  function chevron() {
    return svg([{ name: 'polyline', points: '9 18 15 12 9 6' }]);
  }

  function downChevron() {
    return svg([{ name: 'polyline', points: '6 9 12 15 18 9' }]);
  }

  function editIcon() {
    return svg([
      { d: 'M12 20h9' },
      { d: 'M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z' }
    ]);
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

  function topicHref(item) {
    return '/instructor/curriculum-topic?id=' + encodeURIComponent(item.id);
  }

  function formatTimestamp(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function initials(name) {
    return String(name || 'Instructor').replace(/\s*\(former instructor\)\s*$/i, '').trim()
      .split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) {
        return Array.from(part)[0] || '';
      }).join('');
  }

  function button(label, action, style) {
    var node = element('button', 'curriculum-button' + (style ? ' ' + style : ''));
    node.type = 'button';
    node.dataset.action = action;
    node.textContent = label;
    return node;
  }

  function compactTopic(item) {
    var link = element('a', 'curriculum-compact-topic');
    link.href = topicHref({ id: item.topic_id || item.id });
    var name = element('span', '', item.topic_name || item.name);
    link.appendChild(name);
    link.appendChild(chevron());
    return link;
  }

  function relationSection(title, items, emptyText) {
    var section = element('section', 'curriculum-relation-section');
    section.appendChild(element('h2', '', title));
    if (!items.length) {
      section.appendChild(element('p', 'curriculum-relation-empty', emptyText));
      return section;
    }
    var list = element('div', 'curriculum-relation-list');
    items.forEach(function (item) { list.appendChild(compactTopic(item)); });
    section.appendChild(list);
    return section;
  }

  function repliesFor(contributionId) {
    return contributions.filter(function (item) {
      return Number(item.parent_contribution_id) === Number(contributionId);
    });
  }

  function totalReplies(contributionId) {
    var direct = repliesFor(contributionId);
    return direct.reduce(function (sum, reply) {
      return sum + 1 + totalReplies(reply.id);
    }, 0);
  }

  function createContributionCard(item, depth) {
    var article = element('article', 'curriculum-contribution');
    article.dataset.contributionId = String(item.id);

    var header = element('header', 'curriculum-contribution-header');
    var author = element('div', 'curriculum-author');
    var avatar = element('span', 'curriculum-avatar', initials(item.author_name));
    avatar.setAttribute('aria-hidden', 'true');
    var details = element('div');
    details.appendChild(element('div', 'curriculum-author-name', item.author_name || 'Instructor'));
    var time = element('time', 'curriculum-author-time', formatTimestamp(item.created_at));
    time.dateTime = item.created_at || '';
    if (item.edited_at) time.textContent += ' · edited';
    details.appendChild(time);
    author.appendChild(avatar);
    author.appendChild(details);
    header.appendChild(author);
    article.appendChild(header);

    if (item.response_type) {
      article.appendChild(element(
        'span',
        'curriculum-response-label',
        RESPONSE_LABELS[item.response_type] || 'Response'
      ));
    }

    article.appendChild(element('p', 'curriculum-contribution-text', item.body));

    if (item.linked_topic_id && item.linked_topic_name) {
      var linked = element('a', 'curriculum-linked-topic');
      linked.href = '/instructor/curriculum-topic?id=' + encodeURIComponent(item.linked_topic_id);
      linked.appendChild(svg([
        { name: 'circle', cx: '18', cy: '5', r: '3' },
        { name: 'circle', cx: '6', cy: '12', r: '3' },
        { name: 'circle', cx: '18', cy: '19', r: '3' },
        { name: 'line', x1: '8.59', y1: '13.51', x2: '15.42', y2: '17.49' },
        { name: 'line', x1: '15.41', y1: '6.51', x2: '8.59', y2: '10.49' }
      ]));
      linked.appendChild(document.createTextNode(item.linked_topic_name));
      article.appendChild(linked);
    }

    if (!topic.archived_at) {
      var actions = element('div', 'curriculum-contribution-actions');
      var reply = element('button', '', 'Respond');
      reply.type = 'button';
      reply.dataset.action = 'reply';
      reply.dataset.contributionId = String(item.id);
      reply.dataset.promptKey = item.prompt_key;
      actions.appendChild(reply);
      if (item.is_own) {
        var edit = element('button', '', 'Edit your words');
        edit.type = 'button';
        edit.dataset.action = 'edit-contribution';
        edit.dataset.contributionId = String(item.id);
        actions.appendChild(edit);
      }
      article.appendChild(actions);
    }

    var replies = repliesFor(item.id);
    if (replies.length) {
      var thread = element('details', 'curriculum-thread-replies');
      var count = totalReplies(item.id);
      var summary = element('summary', '', count === 1 ? '1 reply' : count + ' replies');
      thread.appendChild(summary);
      var stack = element('div', 'curriculum-reply-stack');
      replies.forEach(function (reply) {
        stack.appendChild(createContributionCard(reply, depth + 1));
      });
      thread.appendChild(stack);
      article.appendChild(thread);
    }
    return article;
  }

  function createArea(prompt, index) {
    var areaContributions = contributions.filter(function (item) {
      return item.prompt_key === prompt.key;
    });
    var roots = areaContributions.filter(function (item) { return !item.parent_contribution_id; });
    var details = element('details', 'curriculum-area');
    details.dataset.promptKey = prompt.key;
    if (window.location.hash === '#area-' + prompt.key) details.open = true;

    var summary = element('summary');
    summary.appendChild(element('span', 'curriculum-area-number', String(index + 1)));
    summary.appendChild(element('span', 'curriculum-area-title', prompt.label));
    var meta = element('span', 'curriculum-area-meta');
    meta.appendChild(document.createTextNode(
      areaContributions.length === 1 ? '1 input' : areaContributions.length + ' inputs'
    ));
    var icon = downChevron();
    icon.classList.add('curriculum-area-chevron');
    meta.appendChild(icon);
    summary.appendChild(meta);
    details.appendChild(summary);

    var body = element('div', 'curriculum-area-body');
    var toolbar = element('div', 'curriculum-area-toolbar');
    toolbar.appendChild(element('p', '', roots.length ? 'Named conversations' : 'No input here yet'));
    if (!topic.archived_at) {
      var add = element('button', 'curriculum-link-button', 'Add your input');
      add.type = 'button';
      add.dataset.action = 'add-input';
      add.dataset.promptKey = prompt.key;
      toolbar.appendChild(add);
    }
    body.appendChild(toolbar);

    if (!roots.length) {
      body.appendChild(element(
        'div',
        'curriculum-no-contributions',
        topic.archived_at
          ? 'There were no contributions in this area before the topic was archived.'
          : 'Share a useful observation, approach, or question when you are ready.'
      ));
    } else {
      var list = element('div', 'curriculum-thread-list');
      roots.forEach(function (item) { list.appendChild(createContributionCard(item, 0)); });
      body.appendChild(list);
    }
    details.appendChild(body);
    return details;
  }

  function renderWorkspace() {
    var fragment = document.createDocumentFragment();
    var header = element('header', 'curriculum-topic-header');

    if (topic.parent_name) {
      var kicker = element('p', 'curriculum-topic-kicker');
      kicker.textContent = 'Subtopic of ';
      var parentLink = element('a', '', topic.parent_name);
      parentLink.href = '/instructor/curriculum-topic?id=' + encodeURIComponent(topic.parent_topic_id);
      kicker.appendChild(parentLink);
      header.appendChild(kicker);
    } else {
      header.appendChild(element('p', 'curriculum-eyebrow', 'Topic workspace'));
    }

    header.appendChild(element('h1', '', topic.name));
    header.appendChild(element(
      'p',
      'curriculum-topic-description',
      topic.description || 'A shared space for instructors to explore and deepen this topic.'
    ));

    if (topic.archived_at) {
      header.appendChild(element(
        'div',
        'curriculum-admin-banner',
        'This topic is archived. Its conversations remain readable, but new input is closed.'
      ));
    } else {
      var actions = element('div', 'curriculum-topic-actions');
      actions.appendChild(button('Add subtopic', 'add-subtopic'));
      actions.appendChild(button('Connect topic', 'connect-topic'));
      actions.appendChild(button('Suggest a change', 'suggest-change'));
      if (actor && actor.is_admin) {
        actions.appendChild(button('Manage topic', 'manage-topic', 'curriculum-button--primary'));
      }
      header.appendChild(actions);
    }
    fragment.appendChild(header);

    var relations = element('div', 'curriculum-topic-relations');
    relations.appendChild(relationSection(
      'Subtopics',
      subtopics,
      topic.archived_at ? 'No subtopics.' : 'No subtopics yet. Add one when this topic needs more detail.'
    ));
    relations.appendChild(relationSection(
      'Related topics',
      connections,
      topic.archived_at ? 'No related topics.' : 'No connections yet. Link another topic when the relationship is useful.'
    ));
    fragment.appendChild(relations);

    var areas = element('section', 'curriculum-areas');
    var areasHeading = element('header', 'curriculum-areas-heading');
    areasHeading.appendChild(element('h2', '', 'Teaching conversations'));
    areasHeading.appendChild(element(
      'p',
      '',
      'Open any area that feels useful. There is nothing to complete.'
    ));
    areas.appendChild(areasHeading);
    prompts.forEach(function (prompt, index) {
      areas.appendChild(createArea(prompt, index));
    });
    fragment.appendChild(areas);

    workspace.replaceChildren(fragment);
    workspace.setAttribute('aria-busy', 'false');
    mobileAddButton.hidden = !!topic.archived_at;
    document.title = topic.name + ' - Curriculum';
    localStorage.setItem('cc_curriculum_last_topic_id', String(topic.id));
    localStorage.setItem('cc_curriculum_last_topic_name', topic.name);
  }

  function field(labelText, input, optional) {
    var wrap = element('div', 'curriculum-field');
    var label = element('label');
    label.htmlFor = input.id;
    label.appendChild(document.createTextNode(labelText));
    if (optional) label.appendChild(element('span', '', 'Optional'));
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  function inputNode(id, type, maxLength) {
    var input = document.createElement('input');
    input.id = id;
    input.type = type || 'text';
    if (maxLength) input.maxLength = maxLength;
    return input;
  }

  function textareaNode(id, maxLength, rows) {
    var textarea = document.createElement('textarea');
    textarea.id = id;
    textarea.maxLength = maxLength;
    textarea.rows = rows || 5;
    return textarea;
  }

  function selectNode(id, options, selectedValue) {
    var select = document.createElement('select');
    select.id = id;
    options.forEach(function (optionData) {
      var option = document.createElement('option');
      option.value = optionData.value == null ? '' : String(optionData.value);
      option.textContent = optionData.label;
      if (String(option.value) === String(selectedValue == null ? '' : selectedValue)) option.selected = true;
      select.appendChild(option);
    });
    return select;
  }

  function formError() {
    var error = element('p', 'curriculum-form-error');
    error.setAttribute('role', 'alert');
    return error;
  }

  function formActions(submitText) {
    var actions = element('div', 'curriculum-sheet-actions');
    var cancel = element('button', 'curriculum-button curriculum-button--quiet', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.closeWorkspaceSheet = '';
    var submit = element('button', 'curriculum-button curriculum-button--primary', submitText);
    submit.type = 'submit';
    submit.dataset.submitButton = '';
    actions.appendChild(cancel);
    actions.appendChild(submit);
    return actions;
  }

  function topicOptions(includeTopLevel, excludeCurrent) {
    var options = [];
    if (includeTopLevel) options.push({ value: '', label: 'No parent (top-level)' });
    allTopics.forEach(function (item) {
      if (excludeCurrent && Number(item.id) === Number(topicId)) return;
      options.push({
        value: item.id,
        label: item.parent_name ? item.name + ' — under ' + item.parent_name : item.name
      });
    });
    return options;
  }

  function draftKey(mode, suffix) {
    return 'cc_curriculum_draft_' + topicId + '_' + mode + '_' + String(suffix || 'new');
  }

  function readDraft(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (_) { return null; }
  }

  function writeDraft(key, value) {
    if (!key) return;
    var hasValue = Object.keys(value).some(function (item) { return String(value[item] || '').trim(); });
    if (hasValue) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
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

  function openSheet(eyebrow, title, content, focusNode, draftKeyValue) {
    sheetEyebrow.textContent = eyebrow;
    sheetTitle.textContent = title;
    sheetBody.replaceChildren(content);
    activeDraftKey = draftKeyValue || null;
    sheetReturnFocus = document.activeElement;
    sheetBackdrop.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { if (focusNode) focusNode.focus(); }, 30);
  }

  function closeSheet() {
    sheetBackdrop.hidden = true;
    sheetBody.replaceChildren();
    document.body.style.overflow = '';
    activeDraftKey = null;
    if (sheetReturnFocus && typeof sheetReturnFocus.focus === 'function') sheetReturnFocus.focus();
    sheetReturnFocus = null;
  }

  function contributionById(id) {
    return contributions.find(function (item) { return Number(item.id) === Number(id); });
  }

  function openContributionSheet(options) {
    options = options || {};
    var editing = options.editing || null;
    var parent = options.parentId ? contributionById(options.parentId) : null;
    var initialPrompt = options.promptKey || (editing && editing.prompt_key) || (prompts[0] && prompts[0].key);
    var key = draftKey(editing ? 'edit' : parent ? 'reply' : 'input', editing ? editing.id : parent ? parent.id : initialPrompt);
    var draft = editing ? null : readDraft(key);
    var form = document.createElement('form');
    form.noValidate = true;
    form.dataset.formType = editing ? 'edit-contribution' : 'contribution';

    var promptSelect = selectNode(
      'contributionPrompt',
      prompts.map(function (prompt) { return { value: prompt.key, label: prompt.label }; }),
      initialPrompt
    );
    if (parent || editing) promptSelect.disabled = true;
    form.appendChild(field('Contribution area', promptSelect));

    var responseSelect = null;
    var linkedSelect = null;
    if (parent) {
      responseSelect = selectNode(
        'contributionResponseType',
        Object.keys(RESPONSE_LABELS).map(function (keyName) {
          return { value: keyName, label: RESPONSE_LABELS[keyName] };
        }),
        (draft && draft.response_type) || 'build_on'
      );
      form.appendChild(field('How would you like to respond?', responseSelect));

      linkedSelect = selectNode(
        'contributionLinkedTopic',
        [{ value: '', label: 'Choose a topic' }].concat(topicOptions(false, true)),
        draft && draft.linked_topic_id
      );
      var linkedField = field('Topic to connect', linkedSelect);
      linkedField.dataset.linkedTopicField = '';
      linkedField.hidden = responseSelect.value !== 'connect_topic';
      form.appendChild(linkedField);
      responseSelect.addEventListener('change', function () {
        linkedField.hidden = responseSelect.value !== 'connect_topic';
      });
    }

    var body = textareaNode('contributionBody', 5000, 7);
    body.placeholder = parent
      ? 'Write a thoughtful response...'
      : 'Share one useful thought, example, or approach...';
    body.value = editing ? editing.body : (draft && draft.body) || '';
    form.appendChild(field(editing ? 'Your words' : 'What would you like to add?', body));
    form.appendChild(element('p', 'curriculum-draft-note', 'Your draft is saved on this device as you type.'));
    var error = formError();
    form.appendChild(error);
    form.appendChild(formActions(editing ? 'Save changes' : parent ? 'Post response' : 'Add input'));

    function saveContributionDraft() {
      if (editing) return;
      writeDraft(key, {
        prompt_key: promptSelect.value,
        response_type: responseSelect ? responseSelect.value : '',
        linked_topic_id: linkedSelect ? linkedSelect.value : '',
        body: body.value
      });
    }
    form.addEventListener('input', saveContributionDraft);
    form.addEventListener('change', saveContributionDraft);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submit = form.querySelector('[data-submit-button]');
      var text = body.value.trim();
      if (!text) {
        error.textContent = 'Write something before posting.';
        body.focus();
        return;
      }
      if (responseSelect && responseSelect.value === 'connect_topic' && !linkedSelect.value) {
        error.textContent = 'Choose the topic you would like to connect.';
        linkedSelect.focus();
        return;
      }
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = editing ? 'Saving...' : 'Posting...';
      try {
        var action = editing ? 'edit-contribution' : 'create-contribution';
        var payload = editing ? {
          id: editing.id,
          body: text
        } : {
          topic_id: topicId,
          prompt_key: promptSelect.value,
          parent_contribution_id: parent ? parent.id : null,
          response_type: responseSelect ? responseSelect.value : null,
          linked_topic_id: linkedSelect
            && responseSelect.value === 'connect_topic'
            && linkedSelect.value
            ? Number(linkedSelect.value)
            : null,
          body: text
        };
        var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=' + action, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        var data = await readJson(response);
        if (!response.ok || !data.ok) throw new Error(data.message || 'Your input could not be saved.');
        localStorage.removeItem(key);
        closeSheet();
        await loadTopic();
        showToast(editing ? 'Your words were updated.' : parent ? 'Your response was added.' : 'Your input was added.');
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
        submit.textContent = editing ? 'Save changes' : parent ? 'Post response' : 'Add input';
      }
    });

    openSheet(
      editing ? 'Your contribution' : parent ? 'Join the conversation' : 'Add your input',
      editing ? 'Edit your words' : parent ? 'Write a response' : 'Share an idea',
      form,
      body,
      key
    );
  }

  function matchingTopicNames(value) {
    var query = value.trim().toLocaleLowerCase('en-GB');
    if (query.length < 2) return [];
    return allTopics.filter(function (item) {
      var name = item.name.toLocaleLowerCase('en-GB');
      return name.indexOf(query) !== -1 || query.indexOf(name) !== -1;
    }).slice(0, 5);
  }

  function openSubtopicSheet() {
    var key = draftKey('subtopic', 'new');
    var draft = readDraft(key);
    var form = document.createElement('form');
    form.noValidate = true;
    var name = inputNode('subtopicName', 'text', 120);
    name.value = (draft && draft.name) || '';
    var description = textareaNode('subtopicDescription', 1200, 4);
    description.value = (draft && draft.description) || '';
    var matches = element('div', 'curriculum-matches');
    var error = formError();

    form.appendChild(field('Subtopic name', name));
    form.appendChild(matches);
    form.appendChild(field('Short description', description, true));
    form.appendChild(error);
    form.appendChild(formActions('Create subtopic'));

    function renderMatches() {
      var items = matchingTopicNames(name.value);
      var fragment = document.createDocumentFragment();
      if (items.length) fragment.appendChild(element('p', 'curriculum-match-heading', 'Existing topics that may already cover this'));
      items.forEach(function (item) {
        var link = element('a', 'curriculum-match');
        link.href = topicHref(item);
        link.appendChild(element('span', '', item.name));
        link.appendChild(chevron());
        fragment.appendChild(link);
      });
      matches.replaceChildren(fragment);
    }

    function save() {
      writeDraft(key, { name: name.value, description: description.value });
      renderMatches();
    }
    name.addEventListener('input', save);
    description.addEventListener('input', save);
    renderMatches();

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submit = form.querySelector('[data-submit-button]');
      if (!name.value.trim()) {
        error.textContent = 'Enter a subtopic name.';
        name.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Creating...';
      try {
        var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=create-topic', {
          method: 'POST',
          body: JSON.stringify({
            name: name.value.trim(),
            description: description.value.trim(),
            parent_topic_id: topicId
          })
        });
        var data = await readJson(response);
        if (!response.ok || !data.ok || !data.topic) throw new Error(data.message || 'The subtopic could not be created.');
        localStorage.removeItem(key);
        window.location.href = topicHref(data.topic);
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
        submit.textContent = 'Create subtopic';
      }
    });
    openSheet('Build the structure', 'Add a subtopic', form, name, key);
  }

  function openConnectionSheet() {
    var form = document.createElement('form');
    form.noValidate = true;
    var related = selectNode(
      'relatedTopic',
      [{ value: '', label: 'Choose an existing topic' }].concat(topicOptions(false, true))
    );
    var label = inputNode('connectionLabel', 'text', 180);
    label.placeholder = 'e.g. Builds on, often taught alongside';
    var error = formError();
    form.appendChild(field('Topic to connect', related));
    form.appendChild(field('Describe the connection', label, true));
    form.appendChild(error);
    form.appendChild(formActions('Add connection'));
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submit = form.querySelector('[data-submit-button]');
      if (!related.value) {
        error.textContent = 'Choose a topic to connect.';
        related.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Connecting...';
      try {
        var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=create-connection', {
          method: 'POST',
          body: JSON.stringify({
            topic_id: topicId,
            related_topic_id: Number(related.value),
            label: label.value.trim()
          })
        });
        var data = await readJson(response);
        if (!response.ok || !data.ok) throw new Error(data.message || 'The connection could not be added.');
        closeSheet();
        await loadTopic();
        showToast('Topic connection added.');
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
        submit.textContent = 'Add connection';
      }
    });
    openSheet('Topic graph', 'Connect another topic', form, related);
  }

  function openSuggestionSheet() {
    var key = draftKey('suggestion', 'new');
    var draft = readDraft(key);
    var form = document.createElement('form');
    form.noValidate = true;
    var type = selectNode(
      'suggestionType',
      Object.keys(SUGGESTION_LABELS).map(function (item) {
        return { value: item, label: SUGGESTION_LABELS[item] };
      }),
      draft && draft.suggestion_type
    );
    var details = textareaNode('suggestionDetails', 2000, 6);
    details.placeholder = 'Explain what could change and why it would help.';
    details.value = (draft && draft.details) || '';
    var error = formError();
    form.appendChild(field('Type of change', type));
    form.appendChild(field('Your suggestion', details));
    form.appendChild(element('p', 'curriculum-draft-note', 'An admin can review this without changing anyone’s contributions.'));
    form.appendChild(error);
    form.appendChild(formActions('Send suggestion'));
    function save() {
      writeDraft(key, { suggestion_type: type.value, details: details.value });
    }
    form.addEventListener('input', save);
    form.addEventListener('change', save);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var submit = form.querySelector('[data-submit-button]');
      if (!details.value.trim()) {
        error.textContent = 'Add some detail to help the admin understand your suggestion.';
        details.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Sending...';
      try {
        var response = await window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=suggest-structure', {
          method: 'POST',
          body: JSON.stringify({
            topic_id: topicId,
            suggestion_type: type.value,
            details: details.value.trim()
          })
        });
        var data = await readJson(response);
        if (!response.ok || !data.ok) throw new Error(data.message || 'The suggestion could not be sent.');
        localStorage.removeItem(key);
        closeSheet();
        showToast('Your structural suggestion was sent for review.');
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
        submit.textContent = 'Send suggestion';
      }
    });
    openSheet('Help shape the space', 'Suggest a structural change', form, details, key);
  }

  function runAdminOperation(operation, payload, submit, error) {
    submit.disabled = true;
    var original = submit.textContent;
    submit.textContent = 'Saving...';
    return window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=admin-topic', {
      method: 'POST',
      body: JSON.stringify(Object.assign({
        topic_id: topicId,
        operation: operation
      }, payload))
    }).then(readJsonWithResponse).then(function (result) {
      if (!result.response.ok || !result.data.ok) {
        throw new Error(result.data.message || 'The topic could not be updated.');
      }
      closeSheet();
      if (operation === 'archive') {
        return loadTopic().then(function () { showToast('Topic archived. Its history remains readable.'); });
      }
      if (operation === 'merge') {
        window.location.href = '/instructor/curriculum.html';
        return;
      }
      return loadTopic().then(function () { showToast('Topic updated.'); });
    }).catch(function (requestError) {
      error.textContent = requestError.message;
      submit.disabled = false;
      submit.textContent = original;
    });
  }

  function readJsonWithResponse(response) {
    return readJson(response).then(function (data) {
      return { response: response, data: data };
    });
  }

  function adminOperationForm(operation) {
    var form = document.createElement('form');
    form.noValidate = true;
    var error = formError();
    var submitText = 'Save';
    var payloadReader;

    if (operation === 'rename') {
      var name = inputNode('adminTopicName', 'text', 120);
      name.value = topic.name;
      var description = textareaNode('adminTopicDescription', 1200, 4);
      description.value = topic.description || '';
      form.appendChild(field('Topic name', name));
      form.appendChild(field('Description', description, true));
      submitText = 'Save topic';
      payloadReader = function () {
        if (!name.value.trim()) throw new Error('Enter a topic name.');
        return { name: name.value.trim(), description: description.value.trim() };
      };
    } else if (operation === 'move') {
      var parent = selectNode('adminTopicParent', topicOptions(true, true), topic.parent_topic_id);
      form.appendChild(field('Place beneath', parent));
      form.appendChild(element('p', 'curriculum-draft-note', 'Moving changes the browse structure only. Connections and conversations stay intact.'));
      submitText = 'Move topic';
      payloadReader = function () { return { parent_topic_id: parent.value ? Number(parent.value) : null }; };
    } else if (operation === 'merge') {
      var target = selectNode(
        'adminMergeTarget',
        [{ value: '', label: 'Choose the topic to keep' }].concat(topicOptions(false, true))
      );
      form.appendChild(field('Keep this topic', target));
      form.appendChild(element(
        'div',
        'curriculum-admin-banner',
        'This topic will redirect to the kept topic. Its existing conversations remain stored and are not deleted.'
      ));
      submitText = 'Merge safely';
      payloadReader = function () {
        if (!target.value) throw new Error('Choose the topic to keep.');
        return { target_topic_id: Number(target.value) };
      };
    } else {
      form.appendChild(element(
        'div',
        'curriculum-admin-banner',
        'Archiving removes this topic from browse and closes new input. Existing conversations remain readable through their direct link.'
      ));
      submitText = 'Archive topic';
      payloadReader = function () { return {}; };
    }

    form.appendChild(error);
    var actions = formActions(submitText);
    if (operation === 'archive') actions.querySelector('[data-submit-button]').classList.add('curriculum-danger');
    form.appendChild(actions);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      try {
        var payload = payloadReader();
        runAdminOperation(operation, payload, form.querySelector('[data-submit-button]'), error);
      } catch (validationError) {
        error.textContent = validationError.message;
      }
    });
    return form;
  }

  function openAdminSheet() {
    var options = element('div', 'curriculum-admin-options');
    [
      { operation: 'rename', label: 'Rename or edit description' },
      { operation: 'move', label: 'Move in the topic structure' },
      { operation: 'merge', label: 'Merge an accidental duplicate' },
      { operation: 'archive', label: 'Archive this topic' }
    ].forEach(function (item) {
      var option = element('button', 'curriculum-admin-option', item.label);
      option.type = 'button';
      option.dataset.adminOperation = item.operation;
      options.appendChild(option);
    });
    openSheet('Admin controls', 'Manage topic', options, options.querySelector('button'));
  }

  function openSelectedAdminOperation(operation) {
    var labels = {
      rename: 'Edit topic',
      move: 'Move topic',
      merge: 'Merge duplicate',
      archive: 'Archive topic'
    };
    sheetTitle.textContent = labels[operation];
    var form = adminOperationForm(operation);
    sheetBody.replaceChildren(form);
    setTimeout(function () {
      var first = form.querySelector('input, select, textarea, button');
      if (first) first.focus();
    }, 20);
  }

  async function loadTopic() {
    if (!Number.isSafeInteger(topicId) || topicId <= 0) {
      workspace.replaceChildren(element('div', 'curriculum-error', 'Choose a valid Curriculum topic.'));
      workspace.setAttribute('aria-busy', 'false');
      return;
    }
    workspace.setAttribute('aria-busy', 'true');
    try {
      var responses = await Promise.all([
        window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=topic&id=' + encodeURIComponent(topicId)),
        window.ccCurriculumAuth.fetchAuthed('/api/curriculum?action=bootstrap')
      ]);
      var data = await Promise.all(responses.map(readJson));
      if (responses[0].status === 401 || responses[1].status === 401) {
        window.location.href = window.ccCurriculumAuth.loginUrl();
        return;
      }
      if (!responses[0].ok || !data[0].ok) throw new Error(data[0].message || 'Topic could not be loaded.');
      if (data[0].merged_into) {
        window.location.replace('/instructor/curriculum-topic?id=' + encodeURIComponent(data[0].merged_into.id));
        return;
      }
      if (!responses[1].ok || !data[1].ok) throw new Error(data[1].message || 'Topic options could not be loaded.');

      topic = data[0].topic;
      prompts = Array.isArray(data[0].prompts) ? data[0].prompts : [];
      contributions = Array.isArray(data[0].contributions) ? data[0].contributions : [];
      subtopics = Array.isArray(data[0].subtopics) ? data[0].subtopics : [];
      connections = Array.isArray(data[0].connections) ? data[0].connections : [];
      actor = data[0].actor;
      allTopics = Array.isArray(data[1].topics) ? data[1].topics : [];
      renderWorkspace();
    } catch (error) {
      var state = element('div', 'curriculum-error');
      state.appendChild(element('strong', '', 'We could not load this topic'));
      state.appendChild(element('span', '', error.message));
      var retry = element('button', 'curriculum-button', 'Try again');
      retry.type = 'button';
      retry.dataset.action = 'retry-topic';
      state.appendChild(retry);
      workspace.replaceChildren(state);
      workspace.setAttribute('aria-busy', 'false');
    }
  }

  document.addEventListener('click', function (event) {
    var actionNode = event.target.closest('[data-action]');
    if (actionNode) {
      var action = actionNode.dataset.action;
      if (action === 'add-input') {
        openContributionSheet({ promptKey: actionNode.dataset.promptKey });
      } else if (action === 'reply') {
        openContributionSheet({
          promptKey: actionNode.dataset.promptKey,
          parentId: Number(actionNode.dataset.contributionId)
        });
      } else if (action === 'edit-contribution') {
        openContributionSheet({
          editing: contributionById(actionNode.dataset.contributionId)
        });
      } else if (action === 'add-subtopic') {
        openSubtopicSheet();
      } else if (action === 'connect-topic') {
        openConnectionSheet();
      } else if (action === 'suggest-change') {
        openSuggestionSheet();
      } else if (action === 'manage-topic') {
        openAdminSheet();
      } else if (action === 'retry-topic') {
        loadTopic();
      }
    }

    var adminOperation = event.target.closest('[data-admin-operation]');
    if (adminOperation) openSelectedAdminOperation(adminOperation.dataset.adminOperation);
    if (event.target.closest('[data-close-workspace-sheet]')) closeSheet();
  });

  sheetBackdrop.addEventListener('click', function (event) {
    if (event.target === sheetBackdrop) closeSheet();
  });
  document.addEventListener('keydown', function (event) {
    if (sheetBackdrop.hidden) return;
    if (event.key === 'Escape') closeSheet();
    else if (event.key === 'Tab') trapSheetFocus(event);
  });

  loadTopic();
})();
