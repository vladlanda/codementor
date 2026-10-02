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
    const role = el('div', 'role',
      msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'CodeMentor' : msg.role === 'tool' ? 'Tool' : msg.role === 'error' ? 'Error' : 'Checkpoint');
    let body = el('div', 'body');
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'error') {
      body.innerHTML = escapeHtml(msg.text || msg.message || '');
      if (msg.state === 'streaming') box.classList.add('streaming');
    } else if (msg.role === 'tool') {
      body.textContent = '[' + msg.status + '] ' + msg.tool + ' — ' + msg.summary;
    } else if (msg.role === 'checkpoint') {
      body.innerHTML = '<strong>' + escapeHtml(msg.concept) + '</strong><br>' + escapeHtml(msg.explanation);
    } else if (msg.role === 'approval') {
      body.textContent = msg.title + ' — ' + msg.description;
    }
    box.appendChild(role);
    box.appendChild(body);
    transcript.appendChild(box);
    transcript.scrollTop = transcript.scrollHeight;
    return box;
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
      case 'learningCheckpoint':
        appendMessage({ role: 'checkpoint', concept: msg.checkpoint.concept, explanation: msg.checkpoint.explanation, question: msg.checkpoint.question });
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
