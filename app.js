(function () {
  'use strict';

  var valueEl = document.getElementById('value');
  var exprEl = document.getElementById('expression');
  var memInd = document.getElementById('memInd');
  var historyList = document.getElementById('historyList');
  var historyEmpty = document.getElementById('historyEmpty');
  var historyPanel = document.getElementById('historyPanel');
  var toastEl = document.getElementById('toast');
  var keypad = document.getElementById('keypad');
  var pasteModal = document.getElementById('pasteModal');
  var pasteInput = document.getElementById('pasteInput');

  var current = '0';        // 正在输入/显示的数字（字符串）
  var entryNew = true;      // 下一次输入数字时开启新数（当前数尚未进入表达式）
  var justEval = false;     // 刚按过 =
  var fromMem = false;      // 当前值来自 MR
  var errorState = false;
  var lastOp = null, lastOperand = null;  // 连按 = 重复上次运算（运算符显示符号 + 右操作数）
  var chain = [];           // 完整中缀表达式 token：数字字符串 / '+' '-' '×' '÷' / '(' ')'
  var memory = 0;
  var history = [];

  try { history = JSON.parse(localStorage.getItem('calcHistory') || '[]'); } catch (e) { history = []; }

  var OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

  /* ---------- 显示 ---------- */
  function fmt(n) {
    if (typeof n === 'string') return n;
    if (isNaN(n) || !isFinite(n)) return '错误';
    if (n === 0) return '0';
    var a = Math.abs(n);
    if (a >= 1e12 || a < 1e-9) {
      return n.toExponential(6).replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
    }
    return String(parseFloat(n.toPrecision(12)));
  }
  function render() {
    var disp = current;
    if (justEval) {
      disp = current;
    } else if (entryNew) {
      var lr = liveResult();
      if (lr !== null) disp = fmt(lr);
    }
    valueEl.textContent = disp;
    valueEl.scrollLeft = valueEl.scrollWidth;
  }
  function setExpr(s) { exprEl.textContent = s; }
  function setError(msg) { errorState = true; current = msg; entryNew = true; chain = []; lastOp = null; lastOperand = null; setExpr(''); render(); }
  function isOpSym(t) { return t === '+' || t === '−' || t === '×' || t === '÷'; }
  function isOpTok(t) { return isOpSym(t); }

  /* ---------- 表达式求值：中缀→逆波兰(RPN)+栈（运算符优先级 + 括号 + 一元负号） ---------- */
  var SYM2OP = { '+': '+', '−': '-', '×': '*', '÷': '/' };
  function isNumTok(t) { return typeof t === 'string' && /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t); }
  function precOf(op) {
    if (op === 'u-') return 3;
    if (op === '*' || op === '/') return 2;
    if (op === '+' || op === '-') return 1;
    return 0;
  }
  // 当前 chain + 正在输入的数 组装成完整 token 序列
  function buildTokens() {
    var toks = chain.slice();
    if (!entryNew && current !== '' && current !== '错误' && !errorState) toks.push(current);
    return toks;
  }
  // 去除末尾不完整部分（结尾的运算符或左括号），便于"实时预览"求值
  function trimIncomplete(toks) {
    while (toks.length && (isOpSym(toks[toks.length - 1]) || toks[toks.length - 1] === '(')) toks.pop();
    return toks;
  }
  // shunting-yard 转 RPN，再用栈求值
  function evaluate(tokens) {
    var output = [];
    var opStack = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (isNumTok(t)) {
        output.push({ t: 'n', v: parseFloat(t) });
      } else if (t === '(') {
        opStack.push(t);
      } else if (t === ')') {
        while (opStack.length && opStack[opStack.length - 1] !== '(') {
          output.push({ t: 'o', o: opStack.pop() });
        }
        if (!opStack.length) return NaN; // 括号不匹配
        opStack.pop(); // 弹出 '('
      } else if (isOpSym(t)) {
        var op = SYM2OP[t];
        var isUnary = (op === '-') && (i === 0 || isOpSym(tokens[i - 1]) || tokens[i - 1] === '(');
        if (op === '+' && isUnary) { continue; } // 一元正号：忽略
        else if (isUnary) { // 一元负号
          while (opStack.length && opStack[opStack.length - 1] !== '(' && precOf(opStack[opStack.length - 1]) >= 3) {
            output.push({ t: 'o', o: opStack.pop() });
          }
          opStack.push('u-');
        } else {
          while (opStack.length && opStack[opStack.length - 1] !== '(' && precOf(opStack[opStack.length - 1]) >= precOf(op)) {
            output.push({ t: 'o', o: opStack.pop() });
          }
          opStack.push(op);
        }
      } else { return NaN; }
    }
    while (opStack.length) {
      var top = opStack.pop();
      if (top === '(' || top === ')') return NaN;
      output.push({ t: 'o', o: top });
    }
    var st = [];
    for (var j = 0; j < output.length; j++) {
      var it = output[j];
      if (it.t === 'n') st.push(it.v);
      else if (it.o === 'u-') { if (!st.length) return NaN; st.push(-st.pop()); }
      else {
        if (st.length < 2) return NaN;
        var b = st.pop(), a = st.pop(), r;
        switch (it.o) {
          case '+': r = a + b; break;
          case '-': r = a - b; break;
          case '*': r = a * b; break;
          case '/': r = (b === 0) ? NaN : a / b; break;
          default: return NaN;
        }
        st.push(r);
      }
    }
    if (st.length !== 1) return NaN;
    return st[0];
  }
  function liveResult() {
    var toks = trimIncomplete(buildTokens());
    if (toks.length === 0) return null;
    var r = evaluate(toks);
    return (isNaN(r) || !isFinite(r)) ? null : r;
  }

  function inputDigit(d) {
    if (errorState) { errorState = false; current = '0'; entryNew = true; chain = []; }
    if (justEval) { setExpr(''); chain = []; } // 等号后输入新数：开启新一轮表达式
    if (entryNew || fromMem) { current = d; entryNew = false; fromMem = false; }
    else {
      if (current.replace(/[-.]/g, '').length >= 16) return;
      if (current === '0') current = d;
      else if (current === '-0') current = '-' + d;
      else current += d;
    }
    justEval = false;
    render();
  }

  function inputDot() {
    if (errorState) { errorState = false; current = '0'; }
    if (justEval) { setExpr(''); chain = []; }
    if (entryNew || fromMem) { current = '0.'; entryNew = false; fromMem = false; }
    else if (current.indexOf('.') === -1) current += '.';
    justEval = false;
    render();
  }

  function commitCurrent() {
    if (!entryNew && current !== '' && current !== '错误' && !errorState) {
      chain.push(current);
      entryNew = true;
    }
  }
  function applyOp(op) {
    if (errorState) return;
    var sym = OPS[op];
    if (justEval) {
      // 从上次结果开始一条新运算链
      chain = [current];
      entryNew = true;
      justEval = false;
    } else if (entryNew) {
      // 当前没有新数：替换/追加运算符（连按运算符，或括号后接运算符）
      if (chain.length && isOpSym(chain[chain.length - 1])) chain[chain.length - 1] = sym;
      else if (chain.length) chain.push(sym);
      justEval = false;
      setExpr(chain.join(' '));
      render();
      return;
    } else {
      commitCurrent();
    }
    chain.push(sym);
    justEval = false;
    setExpr(chain.join(' '));
    render();
  }
  function inputParen(p) {
    if (errorState) return;
    if (justEval) { chain = [current]; entryNew = true; justEval = false; }
    else if (!entryNew) { commitCurrent(); }
    chain.push(p);
    justEval = false;
    setExpr(chain.join(' '));
    render();
  }

  function getLastOpOperand(toks) {
    for (var i = toks.length - 1; i >= 1; i--) {
      if (isOpSym(toks[i - 1]) && isNumTok(toks[i])) {
        var prev = toks[i - 2];
        if (prev === undefined || isNumTok(prev) || prev === ')') {
          return { op: toks[i - 1], operand: parseFloat(toks[i]) };
        }
      }
    }
    return null;
  }
  function equals() {
    if (errorState) return;
    var toks, r, exprStr;
    if (justEval && lastOp !== null) {
      // 连按 =：在完整表达式后追加 运算符 + 右操作数 再求一次
      chain.push(lastOp);
      chain.push(fmt(lastOperand));
      toks = chain.slice();
      r = evaluate(toks);
      exprStr = chain.join(' ');
    } else {
      toks = trimIncomplete(buildTokens());
      if (toks.length === 0) { r = parseFloat(current); chain = []; }
      else { r = evaluate(toks); chain = toks.slice(); }
      exprStr = (toks.length ? toks : [fmt(r)]).join(' ');
      var lo = getLastOpOperand(toks);
      if (lo) { lastOp = lo.op; lastOperand = lo.operand; } else { lastOp = null; lastOperand = null; }
    }
    if (isNaN(r) || !isFinite(r)) { setError('除数不能为零'); return; }
    current = fmt(r);
    entryNew = true; justEval = true; fromMem = false;
    setExpr(exprStr + ' =');
    addHistory(exprStr, current);
    render();
  }

  function unary(k) {
    if (errorState) return;
    var x = parseFloat(current);
    var r, exprStr;
    if (k === 'sqrt') {
      if (x < 0) { setError('无效输入'); return; }
      r = Math.sqrt(x); exprStr = '√(' + fmt(x) + ')';
    } else if (k === 'sqr') {
      r = x * x; exprStr = 'sqr(' + fmt(x) + ')';
    } else if (k === 'inv') {
      if (x === 0) { setError('除数不能为零'); return; }
      r = 1 / x; exprStr = '1/(' + fmt(x) + ')';
    }
    current = fmt(r);
    entryNew = true; justEval = true; fromMem = false;
    chain = []; lastOp = null; lastOperand = null;
    setExpr(exprStr + ' =');
    addHistory(exprStr, current);
    render();
  }

  function percent() {
    if (errorState) return;
    var x = parseFloat(current);
    if (isNaN(x)) return;
    var base = 0;
    if (chain.length && isOpSym(chain[chain.length - 1])) {
      for (var j = chain.length - 2; j >= 0; j--) {
        if (isNumTok(chain[j])) { base = parseFloat(chain[j]); break; }
      }
    }
    var p = (chain.length && isOpSym(chain[chain.length - 1]) && (chain[chain.length - 1] === '+' || chain[chain.length - 1] === '−')) ? base * x / 100 : x / 100;
    current = fmt(p);
    entryNew = false; fromMem = false; justEval = false;
    render();
  }

  function negate() {
    if (errorState) return;
    if (justEval) { chain = []; }
    if (current.charAt(0) === '-') current = current.slice(1);
    else if (current !== '0') current = '-' + current;
    render();
  }

  function backspace() {
    if (errorState || entryNew || justEval) return;
    current = current.slice(0, -1);
    if (current === '' || current === '-') current = '0';
    render();
  }

  function clearEntry() {
    current = '0'; entryNew = true; errorState = false; fromMem = false;
    setExpr(chain.join(' '));
    render();
  }

  function clearAll() {
    current = '0'; entryNew = true; justEval = false; errorState = false; fromMem = false;
    lastOp = null; lastOperand = null;
    chain = [];
    setExpr('');
    render();
  }

  /* ---------- 记忆功能 ---------- */
  function memAction(m) {
    var x = parseFloat(current);
    if (isNaN(x)) x = 0;
    if (m === 'MC') memory = 0;
    else if (m === 'MR') {
      errorState = false;
      current = fmt(memory);
      entryNew = false; fromMem = true; justEval = false;
      render();
    }
    else if (m === 'MS') memory = x;
    else if (m === 'M+') memory += x;
    else if (m === 'M-') memory -= x;
    memInd.textContent = memory !== 0 ? 'M' : '';
  }

  /* ---------- 历史记录 ---------- */
  function saveHistory() {
    try { localStorage.setItem('calcHistory', JSON.stringify(history.slice(0, 50))); } catch (e) {}
  }
  function addHistory(expr, res) {
    history.unshift({ e: expr, r: res });
    if (history.length > 50) history.length = 50;
    saveHistory();
    renderHistory();
  }
  function renderHistory() {
    historyList.innerHTML = '';
    historyEmpty.style.display = history.length ? 'none' : 'block';
    for (var i = 0; i < history.length; i++) {
      (function (item) {
        var d = document.createElement('div');
        d.className = 'h-item';
        var t = document.createElement('div'); t.className = 'h-text';
        var e1 = document.createElement('div'); e1.className = 'h-expr'; e1.textContent = item.e + ' =';
        var e2 = document.createElement('div'); e2.className = 'h-res'; e2.textContent = item.r;
        t.appendChild(e1); t.appendChild(e2);
        var b = document.createElement('button'); b.className = 'h-copy'; b.textContent = '复制';
        d.appendChild(t); d.appendChild(b);
        b.addEventListener('click', function (ev) { ev.stopPropagation(); copyText(item.r); });
        // 点击历史条目整行：把结果召回计算器，继续运算
        d.addEventListener('click', function () { recall(item.r); });
        historyList.appendChild(d);
      })(history[i]);
    }
  }

  /* ---------- 复制 / 粘贴回填 / 召回 ---------- */
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }
  function copyText(t) {
    function ok() { toast('已复制 ' + t + '（可粘回计算器继续算）'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('复制失败'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(ok, fallback);
    } else fallback();
  }

  // 把一段数字字符串填回显示屏作为当前操作数，便于继续运算
  function recall(numStr) {
    if (!numStr || numStr === '错误') return;
    errorState = false;
    current = numStr;
    entryNew = false; fromMem = false; justEval = false;
    setExpr('');
    render();
    toast('已放回计算器：' + numStr);
  }

  // 从剪贴板解析数字（支持负数、小数、科学计数法），用于"粘贴继续算"
  function parseNumber(text) {
    if (!text) return null;
    var m = text.match(/[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/);
    return m ? m[0] : null;
  }
  document.addEventListener('paste', function (ev) {
    if (ev.target === pasteInput) return; // 弹窗输入框内的粘贴由其自身处理
    var cd = ev.clipboardData || window.clipboardData;
    var text = cd ? cd.getData('text') : '';
    var num = parseNumber(text);
    if (!num) { toast('剪贴板无可粘贴的数字'); return; }
    recall(num);
  });

  /* ---------- 粘贴按键：优先直读剪贴板，失败则弹窗手动粘贴 ---------- */
  function pasteAction() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        var num = parseNumber(t);
        if (num) recall(num);
        else openPasteModal();
      }, openPasteModal);
    } else {
      openPasteModal(); // iOS Safari 等不支持读剪贴板 → 弹窗长按粘贴
    }
  }
  function openPasteModal() {
    pasteModal.classList.add('show');
    pasteInput.value = '';
    setTimeout(function () { try { pasteInput.focus(); } catch (e) {} }, 80);
  }
  function closePasteModal() { pasteModal.classList.remove('show'); }
  function confirmPaste() {
    var num = parseNumber(pasteInput.value);
    if (num) { closePasteModal(); recall(num); }
    else toast('请先粘贴或输入一个数字');
  }
  document.getElementById('pasteConfirm').addEventListener('click', confirmPaste);
  document.getElementById('pasteCancel').addEventListener('click', closePasteModal);
  pasteModal.addEventListener('click', function (ev) { if (ev.target === pasteModal) closePasteModal(); });
  pasteInput.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); confirmPaste(); }
  });
  pasteInput.addEventListener('paste', function (ev) {
    var cd = ev.clipboardData || window.clipboardData;
    var num = parseNumber(cd ? cd.getData('text') : '');
    if (num) { ev.preventDefault(); closePasteModal(); recall(num); }
  });

  /* ---------- 按键高亮（按下闪一下，确认是否按对键） ---------- */
  function flash(el) {
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(function () { el.classList.remove('pressed'); }, 180);
  }

  /* ---------- 事件绑定 ---------- */
  keypad.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    var k = btn.getAttribute('data-k');
    flash(btn);
    if (k.length === 1 && '0123456789'.indexOf(k) > -1) inputDigit(k);
    else if (k === '.') inputDot();
    else if (k === '+' || k === '-' || k === '*' || k === '/') applyOp(k);
    else if (k === '(') inputParen('(');
    else if (k === ')') inputParen(')');
    else if (k === '=') equals();
    else if (k === 'sqrt' || k === 'sqr' || k === 'inv') unary(k);
    else if (k === 'percent') percent();
    else if (k === 'neg') negate();
    else if (k === 'back') backspace();
    else if (k === 'ce') clearEntry();
    else if (k === 'c') clearAll();
  });

  document.querySelector('.memory-row').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    flash(btn);
    if (btn.getAttribute('data-act') === 'paste') { pasteAction(); return; }
    memAction(btn.getAttribute('data-mem'));
  });

  document.getElementById('clearHistory').addEventListener('click', function () {
    history = []; saveHistory(); renderHistory();
  });

  document.getElementById('histToggle').addEventListener('click', function () {
    historyPanel.style.display = (historyPanel.style.display === 'none') ? '' : 'none';
  });

  // 键盘输入也高亮对应按钮
  var keyToBtn = {
    '0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9',
    '.':'.','+':'+','-':'-','*':'*','/':'/','(':'(' ,')':')','=':'=','Enter':'=','%':'percent',
    'Backspace':'back','Escape':'c'
  };
  window.addEventListener('keydown', function (ev) {
    var k = ev.key;
    if (/^[0-9]$/.test(k)) inputDigit(k);
    else if (k === '.') inputDot();
    else if (k === '+' || k === '-' || k === '*' || k === '/') applyOp(k);
    else if (k === '(') inputParen('(');
    else if (k === ')') inputParen(')');
    else if (k === 'Enter' || k === '=') { ev.preventDefault(); equals(); }
    else if (k === 'Backspace') backspace();
    else if (k === 'Escape') clearAll();
    else if (k === '%') percent();
    else return;
    var dk = keyToBtn[k];
    if (dk) flash(document.querySelector('.key[data-k="' + dk + '"]'));
  });

  // 点击显示屏聚焦，便于手机长按粘贴
  valueEl.addEventListener('click', function () { try { valueEl.focus(); } catch (e) {} });

  /* ---------- PWA ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
      // 新 SW 接管后自动刷新一次页面（确保立刻换到新版，不用手动刷）
      // 用局部变量（非 sessionStorage）：每次页面加载允许刷新一次，跨会话不残留标记
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    });
  }

  /* ---------- 初始化 ---------- */
  render();
  renderHistory();
})();
