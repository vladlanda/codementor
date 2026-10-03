/* eslint-disable */
(function () {
  const vscode = acquireVsCodeApi();
  const transcript = document.getElementById('transcript');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const cancelBtn = document.getElementById('cancel');
  const connStatus = document.getElementById('connection-status');
  const connModel = document.getElementById('connection-model');
  const autonomyBadge = document.getElementById('autonomy');
  const depthBadge = document.getElementById('depth');

  let activeTaskId = null;
  let streamingMessageEl = null;
  let streamingMessageId = null;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function appendMessage(msg) {
    const box = el('div', 'msg ' + msg.role);
    const roleLabel =
      msg.role === 'user' ? 'You' :
      msg.role === 'assistant' ? 'CodeMentor' :
      msg.role === 'tool' ? 'Tool' :
      msg.role === 'error' ? 'Error' :
      msg.role === 'checkpoint' ? 'Checkpoint' :
      msg.role === 'knowledgeCheck' ? 'Knowledge check' :
      msg.role === 'followUps' ? 'Follow-up prompts' :
      'Message';
    box.appendChild(el('div', 'role', roleLabel));
    let body = el('div', 'body');
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'error') {
      body.innerHTML = escapeHtml(msg.text || msg.message || '');
      if (msg.state === 'streaming') box.classList.add('streaming');
    } else if (msg.role === 'tool') {
      body.textContent = '[' + msg.status + '] ' + msg.tool + ' — ' + msg.summary;
    } else if (msg.role === 'checkpoint') {
      body.innerHTML = '<strong>' + escapeHtml(msg.concept) + '</strong><br>' + escapeHtml(msg.explanation);
      if (msg.question) body.appendChild(el('div', 'checkpoint-q', msg.question));
    } else if (msg.role === 'approval') {
      body.textContent = msg.title + ' — ' + msg.description;
    } else if (msg.role === 'knowledgeCheck') {
      body.appendChild(el('div', 'check-q', msg.question || ''));
      if (msg.answered) {
        const hint = el('div', 'check-hint answered', 'Your answer: ' + msg.answered);
        body.appendChild(hint);
      } else {
        body.appendChild(renderKnowledgeCheckControls(msg));
      }
    } else if (msg.role === 'followUps') {
      const wrap = el('div', 'followups');
      (msg.suggestions || []).forEach((s) => {
        const btn = el('button', 'btn followup', s.label);
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'followUp', taskId: activeTaskId || 'task_' + Date.now().toString(36), prompt: s.prompt });
          setBusy(true);
        });
        wrap.appendChild(btn);
      });
      body.appendChild(wrap);
    }
    box.appendChild(body);
    transcript.appendChild(box);
    transcript.scrollTop = transcript.scrollHeight;
    return box;
  }

  /** Render the input / hint / submit controls for an (unanswered) knowledge check. */
  function renderKnowledgeCheckControls(msg) {
    const wrap = el('div', 'check-controls');
    if (msg.hint) {
      const hintBtn = el('button', 'btn ghost', 'Show hint');
      const hintBox = el('div', 'check-hint hidden', msg.hint);
      hintBtn.addEventListener('click', () => {
        hintBox.classList.toggle('hidden');
        hintBtn.textContent = hintBox.classList.contains('hidden') ? 'Show hint' : 'Hide hint';
      });
      wrap.appendChild(hintBtn);
      wrap.appendChild(hintBox);
    }
    const textarea = el('textarea', 'check-answer');
    textarea.rows = 3;
    textarea.placeholder = 'Type your answer…';
    const actions = el('div', 'check-actions');
    const submit = el('button', 'btn primary', 'Submit');
    const skip = el('button', 'btn ghost', 'Skip');
    const taskId = activeTaskId || 'task_' + Date.now().toString(36);
    submit.addEventListener('click', () => {
      const answer = textarea.value.trim();
      if (!answer) return;
      wrap.innerHTML = '<div class="check-hint answered">Your answer: ' + escapeHtml(answer) + '</div>';
      vscode.postMessage({ type: 'knowledgeCheckResponse', taskId, checkId: msg.checkId, concept: msg.concept, answer });
    });
    skip.addEventListener('click', () => {
      wrap.innerHTML = '<div class="check-hint skipped">Skipped</div>';
    });
    actions.appendChild(submit);
    actions.appendChild(skip);
    wrap.appendChild(textarea);
    wrap.appendChild(actions);
    return wrap;
  }

  function appendApproval(msg) {
    const box = el('div', 'msg approval' + (msg.risky ? ' risky' : ''));
    box.appendChild(el('div', 'role', msg.risky ? 'Approval (risky)' : 'Approval'));
    const body = el('div', 'body');
    body.innerHTML =
      '<strong>' + escapeHtml(msg.title) + '</strong><br>' +
      escapeHtml(msg.description);
    if (msg.command) {
      body.appendChild(el('div', 'cmd', '$ ' + msg.command));
    }
    if (Array.isArray(msg.diff)) {
      for (const d of msg.diff) {
        const pre = el('pre', 'diff');
        pre.textContent = d.diff || '';
        body.appendChild(pre);
      }
    }
    const actions = el('div', 'approval-actions');
    const approve = el('button', 'btn primary', 'Approve');
    const deny = el('button', 'btn secondary', 'Deny');
    const decide = (approved) => {
      approve.disabled = true;
      deny.disabled = true;
      actions.innerHTML = approved ? '<span class="outcome approved">Approved</span>' : '<span class="outcome denied">Denied</span>';
      vscode.postMessage({ type: 'approvalResponse', requestId: msg.requestId, approved });
    };
    approve.addEventListener('click', () => decide(true));
    deny.addEventListener('click', () => decide(false));
    actions.appendChild(approve);
    actions.appendChild(deny);
    body.appendChild(actions);
    box.appendChild(body);
    transcript.appendChild(box);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function setConnection(info) {
    if (!info) return;
    const dot = info.connected ? 'ok' : 'down';
    connStatus.textContent = (info.provider === 'openai' ? 'OpenAI-compatible' : 'Ollama') + (info.connected ? ' · connected' : ' · not connected');
    connStatus.classList.toggle('ok', info.connected);
    connStatus.classList.toggle('down', !info.connected);
    void dot;
    connModel.textContent = info.model + (info.supportsTools ? ' · tools' : '');
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    cancelBtn.disabled = !busy;
  }

  vscode.onDidReceiveMessage((msg) => {
    switch (msg.type) {
      case 'connectionInfo':
        setConnection(msg.info);
        break;
      case 'stateSnapshot':
        transcript.innerHTML = '';
        msg.messages.forEach(appendMessage);
        activeTaskId = msg.activeTaskId;
        setConnection(msg.connection);
        break;
      case 'streamStart':
        streamingMessageEl = el('div', 'msg assistant streaming');
        streamingMessageEl.appendChild(el('div', 'role', 'CodeMentor'));
        streamingMessageEl.appendChild(el('div', 'body'));
        transcript.appendChild(streamingMessageEl);
        streamingMessageId = msg.messageId;
        break;
      case 'streamChunk':
        if (streamingMessageEl) {
          const body = streamingMessageEl.querySelector('.body');
          body.textContent += msg.delta;
          transcript.scrollTop = transcript.scrollHeight;
        }
        break;
      case 'streamEnd':
        if (streamingMessageEl) streamingMessageEl.classList.remove('streaming');
        streamingMessageEl = null;
        streamingMessageId = null;
        setBusy(false);
        break;
      case 'taskState':
        if (msg.state === 'completed' || msg.state === 'failed' || msg.state === 'cancelled') {
          setBusy(false);
        }
        break;
      case 'error':
        appendMessage({ role: 'error', code: msg.code, message: msg.message });
        setBusy(false);
        break;
      case 'toolEvent':
        appendMessage({ role: 'tool', tool: msg.event.tool, status: msg.event.status, summary: msg.event.summary });
        break;
      case 'approvalRequest':
        appendApproval(msg);
        break;
      case 'learningCheckpoint':
        appendMessage({ role: 'checkpoint', concept: msg.checkpoint.concept, explanation: msg.checkpoint.explanation, question: msg.checkpoint.question });
        break;
      case 'assistantText': {
        // Authoritative, cleaned assistant text (teaching artifacts stripped).
        // Replace the body of the streaming message so the raw block never sticks.
        if (streamingMessageEl) {
          const body = streamingMessageEl.querySelector('.body');
          if (body) body.innerHTML = escapeHtml(msg.text);
          streamingMessageEl.classList.remove('streaming');
        }
        break;
      }
      case 'knowledgeCheck':
        appendMessage({
          role: 'knowledgeCheck',
          checkId: msg.checkId,
          concept: msg.concept,
          question: msg.check.question,
          hint: msg.check.hint,
        });
        break;
      case 'followUps':
        appendMessage({ role: 'followUps', suggestions: msg.suggestions });
        break;
      default:
        break;
    }
  });

  function send() {
    const text = input.value.trim();
    if (!text) return;
    const taskId = 'task_' + Date.now().toString(36);
    activeTaskId = taskId;
    appendMessage({ role: 'user', text });
    input.value = '';
    setBusy(true);
    vscode.postMessage({ type: 'userMessage', taskId, text });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  cancelBtn.addEventListener('click', () => {
    if (activeTaskId) {
      vscode.postMessage({ type: 'cancelTask', taskId: activeTaskId });
    }
  });

  vscode.postMessage({ type: 'requestState' });
})();
