(function () {
  'use strict';

  var MAX_NOTE_LENGTH = 2000;
  var form = document.getElementById('noteForm');
  var input = document.getElementById('noteContent');
  var submitButton = document.getElementById('noteSubmit');
  var characterCount = document.getElementById('noteCharacterCount');
  var fieldError = document.getElementById('noteError');
  var formStatus = document.getElementById('noteFormStatus');
  var feed = document.getElementById('notesFeed');
  var notesCount = document.getElementById('notesCount');
  var noteTotal = 0;

  function setFieldError(message) {
    fieldError.textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function updateCharacterCount() {
    var length = Array.from(input.value).length;
    characterCount.textContent = length.toLocaleString('en-GB') + ' / 2,000';
    if (length <= MAX_NOTE_LENGTH && fieldError.textContent.indexOf('2,000') !== -1) {
      setFieldError('');
    }
  }

  function formatTimestamp(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  function getInitials(name) {
    var parts = String(name || 'Instructor').trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map(function (part) {
      return Array.from(part)[0] || '';
    }).join('');
  }

  function createNoteCard(note) {
    var article = document.createElement('article');
    article.className = 'note-card';
    article.dataset.noteId = String(note.id);

    var header = document.createElement('header');
    header.className = 'note-card-header';

    var avatar = document.createElement('span');
    avatar.className = 'note-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = getInitials(note.author_name);

    var details = document.createElement('div');
    details.className = 'note-author-details';

    var authorLine = document.createElement('div');
    authorLine.className = 'note-author-line';

    var author = document.createElement('span');
    author.className = 'note-author';
    author.textContent = note.author_name || 'Instructor';
    authorLine.appendChild(author);

    if (note.is_current_instructor) {
      var youBadge = document.createElement('span');
      youBadge.className = 'note-you-badge';
      youBadge.textContent = 'You';
      authorLine.appendChild(youBadge);
    }

    var time = document.createElement('time');
    time.className = 'note-time';
    time.dateTime = note.created_at || '';
    time.textContent = formatTimestamp(note.created_at);

    details.appendChild(authorLine);
    details.appendChild(time);
    header.appendChild(avatar);
    header.appendChild(details);

    var content = document.createElement('p');
    content.className = 'note-content';
    content.textContent = note.content;

    article.appendChild(header);
    article.appendChild(content);
    return article;
  }

  function updateFeedCount() {
    notesCount.textContent = noteTotal === 1 ? '1 note' : noteTotal + ' notes';
  }

  function createEmptyState() {
    var empty = document.createElement('div');
    empty.className = 'notes-empty';

    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z');
    var fold = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    fold.setAttribute('d', 'M14 2v6h6');
    icon.appendChild(path);
    icon.appendChild(fold);

    var title = document.createElement('strong');
    title.textContent = 'No notes yet';
    var copy = document.createElement('span');
    copy.textContent = 'Start the conversation by sharing the first idea with your team.';

    empty.appendChild(icon);
    empty.appendChild(title);
    empty.appendChild(copy);
    return empty;
  }

  function createErrorState(message) {
    var wrapper = document.createElement('div');
    wrapper.className = 'notes-error';

    var title = document.createElement('strong');
    title.textContent = 'We could not load the notes';
    var copy = document.createElement('span');
    copy.textContent = message || 'Check your connection and try again.';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'notes-retry';
    retry.dataset.action = 'retry-notes';
    retry.textContent = 'Try again';

    wrapper.appendChild(title);
    wrapper.appendChild(copy);
    wrapper.appendChild(retry);
    return wrapper;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (_) {
      return {};
    }
  }

  async function loadNotes() {
    feed.setAttribute('aria-busy', 'true');
    notesCount.textContent = '';

    try {
      var response = await window.ccAuth.fetchAuthed('/api/instructor?action=list-notes');
      var data = await readJson(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Check your connection and try again.');
      }

      var notes = Array.isArray(data.notes) ? data.notes : [];
      noteTotal = notes.length;
      var fragment = document.createDocumentFragment();
      notes.forEach(function (note) {
        fragment.appendChild(createNoteCard(note));
      });
      feed.replaceChildren(notes.length ? fragment : createEmptyState());
      updateFeedCount();
    } catch (error) {
      noteTotal = 0;
      feed.replaceChildren(createErrorState(error.message));
    } finally {
      feed.setAttribute('aria-busy', 'false');
    }
  }

  async function postNote(event) {
    event.preventDefault();
    setFieldError('');
    formStatus.textContent = '';

    var content = input.value.trim();
    var length = Array.from(content).length;
    if (!content) {
      setFieldError('Write a note before posting.');
      input.focus();
      return;
    }
    if (length > MAX_NOTE_LENGTH) {
      setFieldError('Notes must be 2,000 characters or fewer.');
      input.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Posting...';

    try {
      var response = await window.ccAuth.fetchAuthed('/api/instructor?action=create-note', {
        method: 'POST',
        body: JSON.stringify({ content: content })
      });
      var data = await readJson(response);
      if (!response.ok || !data.ok || !data.note) {
        throw new Error(data.message || 'Your note could not be posted. Please try again.');
      }

      input.value = '';
      updateCharacterCount();
      setFieldError('');

      if (noteTotal === 0) {
        feed.replaceChildren(createNoteCard(data.note));
      } else {
        feed.prepend(createNoteCard(data.note));
      }
      noteTotal += 1;
      updateFeedCount();
      formStatus.textContent = 'Your note has been posted.';
    } catch (error) {
      setFieldError(error.message);
      input.focus();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Post note';
    }
  }

  if (!window.ccAuth.requireAuth()) return;

  input.addEventListener('input', updateCharacterCount);
  input.addEventListener('blur', function () {
    if (input.value.trim() && Array.from(input.value.trim()).length > MAX_NOTE_LENGTH) {
      setFieldError('Notes must be 2,000 characters or fewer.');
    }
  });
  form.addEventListener('submit', postNote);
  document.addEventListener('click', function (event) {
    var action = event.target.closest('[data-action]');
    if (action && action.dataset.action === 'retry-notes') loadNotes();
  });

  updateCharacterCount();
  loadNotes();
})();
