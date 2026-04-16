/**
 * 码字统计插件 - siyuan-plugin-wordcounter v2.1
 * 实时打字速率 + 今日总字数 + 卡通精灵角色 + 可拖拽 + 互动
 */
const siyuan = require("siyuan");

// ============ 常量 ============
const STORAGE_KEY = "wordcounter-data.json";
const SAMPLE_INTERVAL = 500;        // 保底采样间隔（毫秒）
const IDLE_TIMEOUT = 2 * 60 * 1000; // 闲置超时（2分钟）
const SPEED_WINDOW = 6;             // 速率计算窗口（秒）
const SPEED_DECAY_INTERVAL = 3;     // 无输入后开始衰减的秒数

// 精灵互动鼓励语池
const ENCOURAGEMENTS = [
  "加油写!", "棒棒的~", "冲鸭!", "好厉害!",
  "继续保持!", "灵感来了!", "写写写!", "冲冲冲!",
  "今天能成!", "你最棒!", "起飞!", "nice!",
  "字字珠玑!", "妙笔生花!", "一气呵成!",
];

// ============ 工具函数 ============

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function countWords(text) {
  if (!text) return 0;
  let count = 0;
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  count += cjk ? cjk.length : 0;
  const stripped = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ");
  const words = stripped.match(/[a-zA-Z]+/g);
  count += words ? words.length : 0;
  return count;
}

function getEditorText() {
  const editor = document.querySelector(".protyle-content");
  if (!editor) return "";
  return editor.textContent || "";
}

function getActiveDocId() {
  const tab = document.querySelector(".layout-tab-bar .item--focus");
  if (tab && tab.dataset.docId) {
    return tab.dataset.docType === "doc" ? tab.dataset.docId : null;
  }
  const hash = window.location.hash;
  const match = hash.match(/focus=([^&]+)/);
  return match ? match[1] : null;
}

function formatNumber(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + "w";
  return n.toString();
}

function getSpeedLevel(speed) {
  if (speed <= 0) return { level: 0, state: "idle",    color: "#94a3b8", label: "空闲", bubble: "zzZ..." };
  if (speed < 10) return { level: 1, state: "slow",    color: "#22c55e", label: "慢速", bubble: "慢慢来~" };
  if (speed < 30) return { level: 2, state: "medium",  color: "#5b7fff", label: "中速", bubble: "进入状态" };
  if (speed < 60) return { level: 3, state: "fast",    color: "#f59e0b", label: "快速", bubble: "下笔如飞!" };
  return               { level: 4, state: "blazing", color: "#ef4444", label: "飞速", bubble: "爆发中!!!" };
}

/** 生成紧凑精灵 SVG（viewBox 0 0 60 60） */
function renderMascotSVG(state) {
  const bodyColor = "#5b7fff";
  const bodyLight = "#7da2ff";
  const cheekColor = "#ffb3b3";

  const configs = {
    idle: {
      eyes: `
        <line x1="20" y1="28" x2="26" y2="28" stroke="${bodyColor}" stroke-width="2" stroke-linecap="round"/>
        <line x1="34" y1="28" x2="40" y2="28" stroke="${bodyColor}" stroke-width="2" stroke-linecap="round"/>
      `,
      mouth: `<path d="M24 37 Q30 34 36 37" fill="none" stroke="${bodyColor}" stroke-width="1.8" stroke-linecap="round"/>`,
      extra: `
        <g class="wc-zzz">
          <text x="44" y="18" font-size="7" fill="#94a3b8" font-weight="700">z</text>
          <text x="49" y="12" font-size="5.5" fill="#94a3b8" font-weight="700" opacity="0.7">z</text>
          <text x="52" y="8" font-size="4" fill="#94a3b8" font-weight="700" opacity="0.4">z</text>
        </g>
      `,
      blush: `<circle cx="17" cy="34" r="4" fill="${cheekColor}" opacity="0.4"/>`,
    },
    slow: {
      eyes: `
        <circle cx="23" cy="28" r="3" fill="#334155"/>
        <circle cx="37" cy="28" r="3" fill="#334155"/>
        <circle cx="24.2" cy="27" r="1" fill="#fff"/>
        <circle cx="38.2" cy="27" r="1" fill="#fff"/>
      `,
      mouth: `<circle cx="30" cy="36" r="1.6" fill="#f87171"/>`,
      extra: "",
      blush: `<circle cx="17" cy="34" r="4" fill="${cheekColor}" opacity="0.5"/>`,
    },
    medium: {
      eyes: `
        <circle cx="23" cy="27" r="3.5" fill="#334155"/>
        <circle cx="37" cy="27" r="3.5" fill="#334155"/>
        <circle cx="24.3" cy="25.8" r="1.2" fill="#fff"/>
        <circle cx="38.3" cy="25.8" r="1.2" fill="#fff"/>
        <line x1="19" y1="23" x2="26" y2="24" stroke="#334155" stroke-width="1.3" stroke-linecap="round"/>
        <line x1="34" y1="24" x2="41" y2="23" stroke="#334155" stroke-width="1.3" stroke-linecap="round"/>
      `,
      mouth: `<path d="M25 36 Q30 39 35 36" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>`,
      extra: "",
      blush: `<circle cx="17" cy="34" r="4" fill="${cheekColor}" opacity="0.5"/>`,
    },
    fast: {
      eyes: `
        <circle cx="23" cy="26" r="4" fill="#334155"/>
        <circle cx="37" cy="26" r="4" fill="#334155"/>
        <circle cx="24.5" cy="24.5" r="1.5" fill="#fff"/>
        <circle cx="38.5" cy="24.5" r="1.5" fill="#fff"/>
        <line x1="18" y1="21" x2="27" y2="22.5" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="33" y1="22.5" x2="42" y2="21" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>
      `,
      mouth: `<path d="M24 35 Q30 40 36 35" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>`,
      extra: `
        <g class="wc-pen">
          <rect x="41" y="30" width="2.5" height="11" rx="1.2" fill="#f59e0b"/>
          <polygon points="41,41 42.25,46 43.5,41" fill="#334155"/>
        </g>
        <g class="wc-particle" style="--px:-10px;--py:-14px">
          <circle cx="44" cy="24" r="1.6" fill="#f59e0b" opacity="0.7"/>
        </g>
      `,
      blush: `<circle cx="16" cy="33" r="5" fill="${cheekColor}" opacity="0.6"/>`,
    },
    blazing: {
      eyes: `
        <circle cx="23" cy="25" r="4.5" fill="#334155"/>
        <circle cx="37" cy="25" r="4.5" fill="#334155"/>
        <circle cx="24.8" cy="23.5" r="1.8" fill="#fff"/>
        <circle cx="38.8" cy="23.5" r="1.8" fill="#fff"/>
        <line x1="17" y1="19" x2="28" y2="21" stroke="#334155" stroke-width="2.2" stroke-linecap="round"/>
        <line x1="32" y1="21" x2="43" y2="19" stroke="#334155" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M27 30 Q30 31 33 30" fill="none" stroke="#334155" stroke-width="0.8" opacity="0.5"/>
      `,
      mouth: `<path d="M24 34 Q30 41 36 34" fill="#f87171" stroke="#334155" stroke-width="1.2"/>`,
      extra: `
        <circle class="wc-face-glow" cx="30" cy="30" r="27" fill="#ef4444" opacity="0.3"/>
        <g class="wc-pen">
          <rect x="41" y="28" width="3" height="13" rx="1.5" fill="#ef4444"/>
          <polygon points="41,41 42.5,47 44,41" fill="#334155"/>
        </g>
        <g class="wc-particle" style="--px:-8px;--py:-18px">
          <circle cx="43" cy="22" r="2" fill="#ef4444" opacity="0.8"/>
        </g>
        <g class="wc-particle" style="--px:-16px;--py:-12px;animation-delay:0.15s">
          <circle cx="49" cy="26" r="1.6" fill="#f59e0b" opacity="0.6"/>
        </g>
        <g class="wc-particle" style="--px:-6px;--py:-22px;animation-delay:0.3s">
          <circle cx="46" cy="18" r="1.2" fill="#fbbf24" opacity="0.5"/>
        </g>
      `,
      blush: `<circle cx="15" cy="33" r="6" fill="#ff6b6b" opacity="0.5"/>`,
    },
  };

  const cfg = configs[state] || configs.idle;

  return `
    <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
      <circle cx="30" cy="30" r="24" fill="${bodyColor}" opacity="0.15"/>
      <circle cx="30" cy="30" r="21" fill="${bodyColor}"/>
      <ellipse cx="24" cy="22" rx="8" ry="4.5" fill="${bodyLight}" opacity="0.4" transform="rotate(-15 24 22)"/>
      ${cfg.eyes}
      ${cfg.mouth}
      ${cfg.blush}
      ${cfg.extra}
    </svg>
  `;
}

// ============ 主插件类 ============
class WordCounterPlugin extends siyuan.Plugin {
  constructor() {
    super(...arguments);
    this.statusEl = null;
    this.panelEl = null;
    this.panelVisible = false;
    this.sampleTimer = null;
    this.dailyData = {};
    this.lastWordCount = 0;
    this.lastSampleTime = 0;
    this.recentSpeeds = [];
    this.currentSpeed = 0;
    this.lastInputTime = 0;
    this.isIdle = false;
    this._typingBursts = [];
    this._burstStart = 0;
    this._burstLastInput = 0;
    this._burstActive = false;
    this._lastKnownWordCount = 0;
    this._lastTickWordCount = 0;
    this._boundHandleInput = null;
    this.panelTimer = null;
    this._mascotState = "idle";
    this._prevTotalWords = -1;
    // 拖拽状态
    this._dragging = false;
    this._dragOffset = { x: 0, y: 0 };
    // 精灵互动恢复定时器
    this._interactTimer = null;
  }

  async onload() {
    console.log("[码字统计] 插件加载中...");
    this._boundHandleInput = () => this.handleInput();
    await this.loadData();
    this.initStatusBar();
    this.startSampling();
    this.bindEvents();
    console.log("[码字统计] 插件加载完成");
  }

  onunload() {
    this.saveDataSync();
    if (this.sampleTimer) { clearInterval(this.sampleTimer); this.sampleTimer = null; }
    if (this.panelTimer) { clearInterval(this.panelTimer); this.panelTimer = null; }
    if (this._interactTimer) { clearTimeout(this._interactTimer); this._interactTimer = null; }
    this.unbindEvents();
    if (this.panelEl && this.panelEl.parentNode) {
      this.panelEl.parentNode.removeChild(this.panelEl);
    }
    console.log("[码字统计] 插件已卸载");
  }

  onLayoutReady() {}

  // ============ 数据持久化 ============

  async loadData() {
    const today = getTodayStr();
    const defaultData = {
      [today]: { totalWords: 0, peakSpeed: 0, writingTime: 0, idleTime: 0, startTime: null },
      lastDate: today,
    };
    try {
      const saved = await super.loadData(STORAGE_KEY);
      if (saved && typeof saved === "object") {
        this.dailyData = saved;
        if (!this.dailyData[today]) {
          this.dailyData[today] = defaultData[today];
          this.dailyData.lastDate = today;
        }
      } else {
        this.dailyData = defaultData;
      }
    } catch (e) {
      console.warn("[码字统计] 加载数据失败，使用默认值", e);
      this.dailyData = defaultData;
    }
  }

  async saveData() {
    this.dailyData.lastDate = getTodayStr();
    try { await super.saveData(STORAGE_KEY, this.dailyData); }
    catch (e) { console.warn("[码字统计] 保存数据失败", e); }
  }

  saveDataSync() { this.saveData(); }

  getTodayData() {
    const today = getTodayStr();
    if (!this.dailyData[today]) {
      this.dailyData[today] = { totalWords: 0, peakSpeed: 0, writingTime: 0, idleTime: 0, startTime: null };
      this.dailyData.lastDate = today;
    }
    return this.dailyData[today];
  }

  // ============ 状态栏 ============

  initStatusBar() {
    this.statusEl = document.createElement("div");
    this.statusEl.className = "wordcounter-status";
    this.statusEl.innerHTML = this.renderStatusBarHTML(0, 0);
    this.statusEl.title = "码字统计 - 点击查看详情";
    this.addStatusBar({ element: this.statusEl, position: "right" });
    this.statusEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePanel();
    });
  }

  renderStatusBarHTML(speed, totalWords) {
    const info = getSpeedLevel(speed);
    const speedText = speed > 0 ? `${Math.round(speed)}` : "-";
    return `
      <span class="wc-status-inner">
        <span class="wc-speed-dot" style="background:${info.color}"></span>
        <span class="wc-speed-value">${speedText}</span>
        <span class="wc-sep">|</span>
        <span class="wc-total-value">${formatNumber(totalWords)}</span>
        <span class="wc-total-unit">字</span>
      </span>
    `;
  }

  updateStatusBar() {
    if (!this.statusEl) return;
    const todayData = this.getTodayData();
    const speed = this.isIdle ? 0 : this.currentSpeed;
    this.statusEl.innerHTML = this.renderStatusBarHTML(speed, todayData.totalWords);
  }

  // ============ 浮动面板 ============

  togglePanel() {
    if (this.panelVisible) this.hidePanel();
    else this.showPanel();
  }

  showPanel() {
    if (this.panelEl) this.hidePanel();

    this.panelEl = document.createElement("div");
    this.panelEl.className = "wordcounter-panel";
    this.panelEl.innerHTML = this.renderPanelHTML();
    this.panelEl.style.display = "block";

    this.positionPanel();
    document.body.appendChild(this.panelEl);
    this.panelVisible = true;

    this.startPanelUpdate();
    this.bindResetBtn();
    this.bindMinimizeBtn();
    this.bindDrag();
    this.bindMascotInteract();

    // 阻止面板内点击冒泡
    this.panelEl.addEventListener("click", (e) => e.stopPropagation());
  }

  hidePanel() {
    if (this.panelEl && this.panelEl.parentNode) {
      this.panelEl.parentNode.removeChild(this.panelEl);
    }
    this.panelEl = null;
    this.panelVisible = false;
    this.stopPanelUpdate();
    this._dragging = false;
  }

  positionPanel() {
    if (!this.statusEl || !this.panelEl) return;
    const rect = this.statusEl.getBoundingClientRect();
    const panelWidth = 260;
    const panelHeight = this.panelEl.offsetHeight || 280;

    let left = rect.left + rect.width / 2 - panelWidth / 2;
    let top = rect.top - panelHeight - 8;

    if (left < 8) left = 8;
    if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
    if (top < 8) top = rect.bottom + 8;

    this.panelEl.style.left = left + "px";
    this.panelEl.style.top = top + "px";
  }

  renderPanelHTML() {
    const todayData = this.getTodayData();
    const speed = this.isIdle ? 0 : this.currentSpeed;
    const info = getSpeedLevel(speed);
    const avgSpeed = this._getCalibratedAvgSpeed();
    const avgInfo = getSpeedLevel(avgSpeed);

    const wMins = Math.floor(todayData.writingTime / 60);
    const wTimeStr = wMins >= 60 ? `${Math.floor(wMins / 60)}h${wMins % 60}m` : `${wMins}m`;
    const iMins = Math.floor(todayData.idleTime / 60);
    const iTimeStr = iMins >= 60 ? `${Math.floor(iMins / 60)}h${iMins % 60}m` : `${iMins}m`;

    const writePercent = Math.min(100, (todayData.writingTime / (8 * 3600)) * 100);

    return `
      <div class="wc-panel-header" id="wc-drag-handle">
        <span class="wc-panel-title">码字统计</span>
        <div class="wc-panel-header-actions">
          <span class="wc-panel-date">${getTodayStr()}</span>
          <button class="wc-minimize-btn" id="wc-minimize-btn" title="最小化">
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>

      <!-- 精灵 + Hero 融合区 -->
      <div class="wc-hero-bg" data-speed="${info.state}">
        <div class="wc-panel-hero">
          <div class="wc-hero-mascot">
            <div class="wc-mascot" id="wc-mascot" data-state="${info.state}">
              ${renderMascotSVG(info.state)}
            </div>
            <span class="wc-mascot-bubble wc-bubble-show" id="wc-mascot-bubble">${info.bubble}</span>
          </div>
          <div class="wc-hero-data">
            <div class="wc-hero-row">
              <span class="wc-hero-num wc-total-num">${formatNumber(todayData.totalWords)}</span>
              <span class="wc-hero-label">今日字数</span>
            </div>
            <div class="wc-hero-row">
              <span class="wc-hero-num wc-speed-num wc-speed-${info.state}">
                ${speed > 0 ? Math.round(speed) : "-"}
              </span>
              <span class="wc-hero-sub wc-speed-${info.state}">${info.label}</span>
              <span class="wc-hero-label">字/分</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 写作时间进度条 -->
      <div class="wc-progress-bar">
        <div class="wc-progress-fill" style="width:${writePercent}%"></div>
      </div>

      <!-- 指标卡片 4列 -->
      <div class="wc-panel-metrics">
        <div class="wc-metric-card">
          <span class="wc-metric-num wc-speed-${avgInfo.state}">${avgSpeed}</span>
          <span class="wc-metric-label">平均</span>
        </div>
        <div class="wc-metric-card">
          <span class="wc-metric-num wc-speed-fast">${todayData.peakSpeed}</span>
          <span class="wc-metric-label">峰值</span>
        </div>
        <div class="wc-metric-card">
          <span class="wc-metric-num wc-time-val">${wTimeStr}</span>
          <span class="wc-metric-label">写作</span>
        </div>
        <div class="wc-metric-card">
          <span class="wc-metric-num wc-idle-val">${iTimeStr}</span>
          <span class="wc-metric-label">休息</span>
        </div>
      </div>

      <!-- 底部状态 + 重置 -->
      <div class="wc-panel-bottom">
        <div class="wc-panel-status">
          <span class="wc-status-dot ${this.isIdle ? "" : "wc-dot-active"}" style="background:${this.isIdle ? "#94a3b8" : "#22c55e"}"></span>
          <span class="wc-status-text">${this.isIdle ? "暂停中" : "写作中"}</span>
        </div>
        <button class="wc-reset-btn" id="wc-reset-btn">重置</button>
      </div>
    `;
  }

  startPanelUpdate() {
    this.stopPanelUpdate();
    this.panelTimer = setInterval(() => {
      if (this.panelEl && this.panelVisible) this.updatePanelContent();
    }, 1000);
  }

  updatePanelContent() {
    if (!this.panelEl) return;
    const todayData = this.getTodayData();
    const speed = this.isIdle ? 0 : this.currentSpeed;
    const info = getSpeedLevel(speed);

    // ---- 精灵状态更新（跳过互动中） ----
    const mascot = this.panelEl.querySelector(".wc-mascot");
    if (mascot && mascot.dataset.state !== info.state) {
      // 只在非互动状态下更新精灵表情
      if (!mascot.classList.contains("wc-mascot-interact")) {
        mascot.dataset.state = info.state;
        const svgEl = mascot.querySelector("svg");
        if (svgEl) svgEl.outerHTML = renderMascotSVG(info.state);
      }
      // 更新速率气泡
      const bubble = this.panelEl.querySelector("#wc-mascot-bubble");
      if (bubble && !mascot.classList.contains("wc-mascot-interact")) {
        bubble.textContent = info.bubble;
      }
    }

    // ---- Hero 背景 ----
    const heroBg = this.panelEl.querySelector(".wc-hero-bg");
    if (heroBg) heroBg.dataset.speed = info.state;

    // ---- Hero 数字 ----
    const totalEl = this.panelEl.querySelector(".wc-total-num");
    if (totalEl) {
      const newText = formatNumber(todayData.totalWords);
      if (this._prevTotalWords >= 0 && todayData.totalWords !== this._prevTotalWords) {
        totalEl.classList.remove("wc-num-bump");
        void totalEl.offsetWidth;
        totalEl.classList.add("wc-num-bump");
      }
      totalEl.textContent = newText;
      this._prevTotalWords = todayData.totalWords;
    }

    const speedNumEl = this.panelEl.querySelector(".wc-speed-num");
    if (speedNumEl) {
      speedNumEl.className = "wc-hero-num wc-speed-num wc-speed-" + info.state;
      speedNumEl.textContent = speed > 0 ? Math.round(speed) : "-";
    }
    const speedSubEl = this.panelEl.querySelector(".wc-hero-sub");
    if (speedSubEl) {
      speedSubEl.className = "wc-hero-sub wc-speed-" + info.state;
      speedSubEl.textContent = info.label;
    }

    // ---- 进度条 ----
    const writePercent = Math.min(100, (todayData.writingTime / (8 * 3600)) * 100);
    const progressFill = this.panelEl.querySelector(".wc-progress-fill");
    if (progressFill) progressFill.style.width = writePercent + "%";

    // ---- Metrics ----
    const avgSpeed = this._getCalibratedAvgSpeed();
    const avgInfo = getSpeedLevel(avgSpeed);
    const metricNums = this.panelEl.querySelectorAll(".wc-metric-num");
    if (metricNums[0]) {
      metricNums[0].textContent = avgSpeed;
      metricNums[0].className = "wc-metric-num wc-speed-" + avgInfo.state;
    }
    if (metricNums[1]) {
      metricNums[1].textContent = todayData.peakSpeed;
      metricNums[1].className = "wc-metric-num wc-speed-fast";
    }

    const wMins = Math.floor(todayData.writingTime / 60);
    const wTimeStr = wMins >= 60 ? Math.floor(wMins / 60) + "h" + (wMins % 60) + "m" : wMins + "m";
    const iMins = Math.floor(todayData.idleTime / 60);
    const iTimeStr = iMins >= 60 ? Math.floor(iMins / 60) + "h" + (iMins % 60) + "m" : iMins + "m";
    if (metricNums[2]) metricNums[2].textContent = wTimeStr;
    if (metricNums[3]) metricNums[3].textContent = iTimeStr;

    // ---- 状态栏 ----
    const statusText = this.panelEl.querySelector(".wc-panel-status .wc-status-text:last-child");
    const statusDot = this.panelEl.querySelector(".wc-status-dot");
    if (statusText) statusText.textContent = this.isIdle ? "暂停中" : "写作中";
    if (statusDot) {
      statusDot.style.background = this.isIdle ? "#94a3b8" : info.color;
      statusDot.className = "wc-status-dot";
      if (!this.isIdle) {
        if (info.state === "fast") statusDot.classList.add("wc-dot-fast");
        else if (info.state === "blazing") statusDot.classList.add("wc-dot-blazing");
        else statusDot.classList.add("wc-dot-active");
      }
    }
  }

  stopPanelUpdate() {
    if (this.panelTimer) { clearInterval(this.panelTimer); this.panelTimer = null; }
  }

  // ============ 拖拽 ============

  bindDrag() {
    if (!this.panelEl) return;
    const handle = this.panelEl.querySelector("#wc-drag-handle");
    if (!handle) return;

    const onDown = (e) => {
      // 只响应左键拖拽
      if (e.button !== 0) return;
      // 不拖拽按钮
      if (e.target.closest(".wc-minimize-btn")) return;
      this._dragging = true;
      const rect = this.panelEl.getBoundingClientRect();
      this._dragOffset.x = (e.clientX || e.pageX) - rect.left;
      this._dragOffset.y = (e.clientY || e.pageY) - rect.top;
      this.panelEl.style.transition = "none";
      document.body.style.cursor = "grabbing";
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!this._dragging) return;
      const x = (e.clientX || e.pageX) - this._dragOffset.x;
      const y = (e.clientY || e.pageY) - this._dragOffset.y;
      this.panelEl.style.left = x + "px";
      this.panelEl.style.top = y + "px";
    };

    const onUp = () => {
      if (!this._dragging) return;
      this._dragging = false;
      this.panelEl.style.transition = "";
      document.body.style.cursor = "";
      // 防止拖出屏幕
      this._clampPanel();
    };

    handle.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    // 清理引用
    this._dragCleanup = () => {
      handle.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }

  /** 防止面板拖出可视区域 */
  _clampPanel() {
    if (!this.panelEl) return;
    const rect = this.panelEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height;
    this.panelEl.style.left = left + "px";
    this.panelEl.style.top = top + "px";
  }

  // ============ 精灵互动 ============

  bindMascotInteract() {
    if (!this.panelEl) return;
    const mascot = this.panelEl.querySelector("#wc-mascot");
    if (!mascot) return;

    mascot.style.cursor = "pointer";

    mascot.addEventListener("click", (e) => {
      e.stopPropagation();
      this._mascotInteract();
    });
  }

  _mascotInteract() {
    if (!this.panelEl) return;
    const mascot = this.panelEl.querySelector("#wc-mascot");
    const bubble = this.panelEl.querySelector("#wc-mascot-bubble");
    if (!mascot || !bubble) return;

    // 弹跳动画
    mascot.classList.add("wc-mascot-bounce");
    mascot.classList.add("wc-mascot-interact");

    // 随机鼓励语
    const msg = ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)];
    bubble.textContent = msg;
    bubble.classList.remove("wc-bubble-show");
    void bubble.offsetWidth;
    bubble.classList.add("wc-bubble-show");

    // 清除旧定时器
    if (this._interactTimer) clearTimeout(this._interactTimer);

    // 2秒后恢复
    this._interactTimer = setTimeout(() => {
      if (!mascot || !bubble) return;
      mascot.classList.remove("wc-mascot-bounce");
      mascot.classList.remove("wc-mascot-interact");
      // 恢复速率气泡
      const speed = this.isIdle ? 0 : this.currentSpeed;
      const info = getSpeedLevel(speed);
      bubble.textContent = info.bubble;
    }, 2000);
  }

  // ============ 按钮绑定 ============

  bindResetBtn() {
    if (!this.panelEl) return;
    const btn = this.panelEl.querySelector("#wc-reset-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.resetToday();
      });
    }
  }

  async resetToday() {
    const today = getTodayStr();
    this.dailyData[today] = { totalWords: 0, peakSpeed: 0, writingTime: 0, idleTime: 0, startTime: null };
    this.currentSpeed = 0;
    this.lastWordCount = 0;
    this.recentSpeeds = [];
    this._prevTotalWords = -1;
    await this.saveData();
    this.updateStatusBar();
    siyuan.showMessage("今日数据已重置", 3000);
  }

  bindMinimizeBtn() {
    if (!this.panelEl) return;
    const btn = this.panelEl.querySelector("#wc-minimize-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hidePanel();
      });
    }
  }

  // ============ 事件监听 ============

  bindEvents() {
    const events = ["ws-main", "click-editorcontent"];
    for (const evt of events) this.eventBus.on(evt, this._boundHandleInput);
    document.addEventListener("keydown", this._boundHandleInput, { passive: true });

    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" ||
            (mutation.type === "childList" && mutation.target.closest?.(".protyle-content"))) {
          this.handleInput();
          break;
        }
      }
    });

    setTimeout(() => {
      const editor = document.querySelector("#editor");
      if (editor) {
        this._observer.observe(editor, {
          childList: true, subtree: true, characterData: true,
        });
      }
    }, 2000);
  }

  unbindEvents() {
    const events = ["ws-main", "click-editorcontent"];
    for (const evt of events) this.eventBus.off(evt, this._boundHandleInput);
    document.removeEventListener("keydown", this._boundHandleInput);
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
  }

  // ============ 输入处理 ============

  handleInput() {
    const now = Date.now();
    this.lastInputTime = now;
    if (this.isIdle) this.isIdle = false;

    const text = getEditorText();
    const currentCount = countWords(text);

    if (this._burstActive) {
      const delta = currentCount - this._lastTickWordCount;
      if (delta > 0) this._burstLastInput = now;
    } else {
      this._burstActive = true;
      this._burstStart = now;
      this._burstLastInput = now;
      this._lastKnownWordCount = currentCount;
    }
    this._lastTickWordCount = currentCount;
  }

  // ============ 采样与速率计算 ============

  startSampling() {
    this.lastSampleTime = Date.now();
    this.lastInputTime = Date.now();
    this.lastWordCount = countWords(getEditorText()) || 0;
    this._lastKnownWordCount = this.lastWordCount;
    this._lastTickWordCount = this.lastWordCount;

    this.sampleTimer = setInterval(() => this.sample(), SAMPLE_INTERVAL);
  }

  sample() {
    const now = Date.now();

    if (now - this.lastInputTime > IDLE_TIMEOUT) {
      if (!this.isIdle) {
        this.isIdle = true;
        this.currentSpeed = 0;
        this.recentSpeeds = [];
        this._burstActive = false;
        this.updateStatusBar();
      }
      return;
    }

    if (this._burstActive && (now - this._burstLastInput > SPEED_DECAY_INTERVAL * 1000)) {
      this._closeBurst(now);
    }

    const text = getEditorText();
    const currentCount = countWords(text);
    const deltaWords = currentCount - this.lastWordCount;

    if (deltaWords < -50) {
      this.lastWordCount = currentCount;
      this._lastKnownWordCount = currentCount;
      this._lastTickWordCount = currentCount;
      this._burstActive = false;
      return;
    }

    const deltaSec = (now - this.lastSampleTime) / 1000;
    if (deltaSec <= 0) return;

    if (deltaWords > 0) {
      const todayData = this.getTodayData();
      todayData.totalWords += deltaWords;
      if (!todayData.startTime) todayData.startTime = now;
    }

    this._calcSpeed(now);

    if (this._burstActive) {
      this.getTodayData().writingTime += deltaSec;
    } else if (this.lastInputTime > 0) {
      if (now - this.lastInputTime <= IDLE_TIMEOUT) {
        this.getTodayData().idleTime += deltaSec;
      }
    }

    if (this.currentSpeed > 0) {
      const todayData = this.getTodayData();
      const rounded = Math.round(this.currentSpeed);
      if (rounded > todayData.peakSpeed) todayData.peakSpeed = rounded;
    }

    this.lastWordCount = currentCount;
    this.lastSampleTime = now;

    if (Math.random() < 0.05) this.saveData();
    this.updateStatusBar();
  }

  _closeBurst(now) {
    if (!this._burstActive) return;
    const text = getEditorText();
    const currentCount = countWords(text);
    const burstWords = currentCount - this._lastKnownWordCount;

    if (burstWords > 0) {
      const duration = (now - this._burstStart) / 1000;
      if (duration > 0) {
        const speed = (burstWords / duration) * 60;
        this.recentSpeeds.push({ speed, time: this._burstStart, endTime: now, words: burstWords, duration });
      }
    }

    this._burstActive = false;
    this._lastKnownWordCount = currentCount;
    const cutoff = now - SPEED_WINDOW * 1000;
    this.recentSpeeds = this.recentSpeeds.filter(s => s.time >= cutoff);
  }

  _calcSpeed(now) {
    let totalWords = 0;
    let totalDuration = 0;

    for (const burst of this.recentSpeeds) {
      totalWords += burst.words;
      totalDuration += burst.duration;
    }

    if (this._burstActive) {
      const text = getEditorText();
      const currentCount = countWords(text);
      const burstWords = Math.max(0, currentCount - this._lastKnownWordCount);
      const burstDuration = (now - this._burstStart) / 1000;
      if (burstWords > 0 && burstDuration > 0) {
        totalWords += burstWords;
        totalDuration += burstDuration;
      }
    }

    let rawWindowSpeed = 0;
    if (totalDuration > 0 && totalWords > 0) {
      rawWindowSpeed = (totalWords / totalDuration) * 60;
    }

    const todayData = this.getTodayData();
    const writingMinutes = todayData.writingTime / 60;
    const dailyAvg = (writingMinutes > 0 && todayData.totalWords > 0)
      ? todayData.totalWords / writingMinutes : 0;

    let finalSpeed = 0;

    if (rawWindowSpeed > 0) {
      if (dailyAvg > 0) {
        finalSpeed = rawWindowSpeed * 0.30 + this.currentSpeed * 0.40 + dailyAvg * 0.30;
      } else {
        finalSpeed = rawWindowSpeed * 0.40 + this.currentSpeed * 0.60;
      }

      const ABS_MAX = 120;
      if (finalSpeed > ABS_MAX) {
        finalSpeed = dailyAvg > 0 ? dailyAvg + (ABS_MAX - dailyAvg) * 0.3 : ABS_MAX * 0.5;
      }

      if (dailyAvg > 0) {
        const upperBound = dailyAvg * 1.8;
        if (finalSpeed > upperBound) {
          finalSpeed = upperBound + (finalSpeed - upperBound) * 0.2;
        }
      }

      this.currentSpeed = finalSpeed;
    } else {
      this.currentSpeed *= 0.5;
      if (this.currentSpeed < 0.5) this.currentSpeed = 0;
    }
  }

  _getCalibratedAvgSpeed() {
    const todayData = this.getTodayData();
    const writingMinutes = todayData.writingTime / 60;
    if (writingMinutes < 0.5) return 0;

    const dailyAvg = todayData.totalWords / writingMinutes;
    if (!this.isIdle && this.currentSpeed > 0) {
      const avgWeight = Math.min(0.9, 0.7 + writingMinutes * 0.002);
      return Math.round(dailyAvg * avgWeight + this.currentSpeed * (1 - avgWeight));
    }
    return Math.round(dailyAvg);
  }
}

module.exports = WordCounterPlugin;
