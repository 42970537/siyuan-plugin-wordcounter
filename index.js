/**
 * 码字统计插件 - siyuan-plugin-wordcounter v4.1.0
 * v4.1:  回归累积模式（所有文档共用统计）
 *        - 最小化改为可拖动浮层面板，标注插件名称
 *        - 峰值改为平均速率的峰值（带单位显示）
 *        - 速率在发呆时持续 EMA 衰减，不再瞬间清零
 */
const siyuan = require("siyuan");

// ============ 常量 ============
const STORAGE_KEY = "wordcounter-data.json";
const SETTINGS_KEY = "wordcounter-settings.json";
const SAMPLE_INTERVAL = 200;       // 数据采样间隔（毫秒）
const IDLE_TIMEOUT = 5 * 60 * 1000; // 发呆阈值 5 分钟（规范要求 5-10 分钟）
const SPEED_WINDOW = 5 * 60 * 1000; // 滑动时间窗口 5 分钟（毫秒）
const MASCOT_HYSTERESIS_MS = 2000;  // 精灵状态滞回（稳定后切换）
const UI_THROTTLE_MS = 100;         // UI 更新节流（requestAnimationFrame）
// EMA 平滑系数（增长快·衰减慢）
const EMA_MAIN = 0.2;     // 主速率平滑系数 α=0.2

// 模式标签
const MODE_LABELS = {
  writing: { name: "码字模式", perMin: "字/分", perHour: "字/时", wordUnit: "字" },
  coding:  { name: "编程模式", perMin: "字符/分", perHour: "字符/时", wordUnit: "字符" },
};

// 精灵配置
const MASCOTS = {
  cat: {
    name: "蓝猫",
    body: "#5b7fff", bodyLight: "#7da2ff", cheek: "#ffb3b3",
    bubbleBg: "rgba(91, 127, 255, 0.85)",
    bubbleArrow: "rgba(91, 127, 255, 0.9)",
    ears: `<polygon points="12,16 18,6 24,16" fill="currentColor" class="wc-mascot-ear"/><polygon points="36,16 42,6 48,16" fill="currentColor" class="wc-mascot-ear"/>`,
    tail: `<path d="M48,40 Q56,36 54,44" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="wc-mascot-tail"/>`,
  },
  rabbit: {
    name: "粉兔",
    body: "#f472b6", bodyLight: "#f9a8d4", cheek: "#fda4af",
    bubbleBg: "rgba(244, 114, 182, 0.85)",
    bubbleArrow: "rgba(244, 114, 182, 0.9)",
    ears: `<ellipse cx="20" cy="8" rx="4" ry="12" fill="currentColor" class="wc-mascot-ear"/><ellipse cx="40" cy="8" rx="4" ry="12" fill="currentColor" class="wc-mascot-ear"/>
           <ellipse cx="20" cy="8" rx="2" ry="9" fill="#fda4af" opacity="0.5"/><ellipse cx="40" cy="8" rx="2" ry="9" fill="#fda4af" opacity="0.5"/>`,
    tail: `<circle cx="52" cy="38" r="4" fill="currentColor" opacity="0.5" class="wc-mascot-tail"/>`,
  },
  dragon: {
    name: "绿龙",
    body: "#22c55e", bodyLight: "#4ade80", cheek: "#bbf7d0",
    bubbleBg: "rgba(34, 197, 94, 0.85)",
    bubbleArrow: "rgba(34, 197, 94, 0.9)",
    ears: `<polygon points="14,14 8,4 22,12" fill="currentColor" class="wc-mascot-ear"/><polygon points="46,14 52,4 38,12" fill="currentColor" class="wc-mascot-ear"/>`,
    tail: `<path d="M48,42 Q58,38 60,48 Q56,44 50,46" fill="currentColor" class="wc-mascot-tail"/>`,
    horn: `<polygon points="22,8 26,2 28,10" fill="#fbbf24" opacity="0.8"/><polygon points="32,8 34,2 38,10" fill="#fbbf24" opacity="0.8"/>`,
  },
  fox: {
    name: "橙狐",
    body: "#f97316", bodyLight: "#fb923c", cheek: "#fed7aa",
    bubbleBg: "rgba(249, 115, 22, 0.85)",
    bubbleArrow: "rgba(249, 115, 22, 0.9)",
    ears: `<polygon points="12,18 16,4 26,16" fill="currentColor" class="wc-mascot-ear"/><polygon points="48,18 44,4 34,16" fill="currentColor" class="wc-mascot-ear"/>
           <polygon points="15,16 18,7 24,15" fill="#fff" opacity="0.4" class="wc-mascot-ear-inner"/><polygon points="45,16 42,7 36,15" fill="#fff" opacity="0.4" class="wc-mascot-ear-inner"/>`,
    tail: `<path d="M48,36 Q60,28 54,40 Q48,42 46,40" fill="currentColor" class="wc-mascot-tail"/>
           <path d="M48,36 Q60,28 54,40" fill="#fff" opacity="0.6"/>`,
  },
  owl: {
    name: "紫鹰",
    body: "#8b5cf6", bodyLight: "#a78bfa", cheek: "#ddd6fe",
    bubbleBg: "rgba(139, 92, 246, 0.85)",
    bubbleArrow: "rgba(139, 92, 246, 0.9)",
    ears: `<polygon points="14,16 10,4 22,14" fill="currentColor" class="wc-mascot-ear"/><polygon points="46,16 50,4 38,14" fill="currentColor" class="wc-mascot-ear"/>`,
    tail: `<path d="M22,46 Q30,52 38,46" fill="currentColor" opacity="0.6" class="wc-mascot-tail"/>`,
    wing: `<path d="M6,30 Q0,40 10,46 Q14,42 14,34 Z" fill="currentColor" opacity="0.3" class="wc-mascot-wing-l"/>
           <path d="M54,30 Q60,40 50,46 Q46,42 46,34 Z" fill="currentColor" opacity="0.3" class="wc-mascot-wing-r"/>`,
  },
};

// 精灵互动鼓励语池
const ENCOURAGEMENTS = {
  writing: [
    "加油写!", "棒棒的~", "冲鸭!", "好厉害!",
    "继续保持!", "灵感来了!", "写写写!", "冲冲冲!",
    "今天能成!", "你最棒!", "起飞!", "nice!",
    "字字珠玑!", "妙笔生花!", "一气呵成!", "高产作者!",
  ],
  coding: [
    "敲敲敲!", "代码万岁!", "bug退散!", "厉害!",
    "逻辑满分!", "效率拉满!", "键盘着火!", "冲冲冲!",
    "大神!", "牛!", "起飞!", "nice!",
    "无BUG!", "一次过!", "完美编译!", "优雅!",
  ],
};

// ============ 工具函数 ============
function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function countWordsWriting(text) {
  if (!text) return 0;
  let count = 0;
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  count += cjk ? cjk.length : 0;
  const stripped = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ");
  const words = stripped.match(/[a-zA-Z]+/g);
  count += words ? words.length : 0;
  return count;
}

function countWordsCoding(text) {
  if (!text) return 0;
  return text.replace(/\s/g, "").length;
}

function getEditorText() {
  // 优先取当前激活 tab 下的编辑器内容
  const activeTab = document.querySelector(".layout-tab-bar .item--focus");
  let editor = null;
  if (activeTab) {
    // 在当前激活 tab 的 DOM 区域里找编辑器
    const tabPanel = activeTab.closest(".layout-tab-container") || activeTab.parentElement;
    if (tabPanel) {
      editor = tabPanel.querySelector(".protyle-content");
    }
  }
  // fallback：取任意编辑器
  if (!editor) editor = document.querySelector(".protyle-content");
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

function formatMinutes(totalSec) {
  const mins = Math.floor(totalSec / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60}m` : `${mins}m`;
}

function getSpeedLevel(speed) {
  if (speed <= 0) return { level: 0, state: "idle",    color: "#94a3b8", label: "空闲", bubble: "zzZ..." };
  if (speed < 10) return { level: 1, state: "slow",    color: "#22c55e", label: "慢速", bubble: "慢慢来~" };
  if (speed < 30) return { level: 2, state: "medium",  color: "#5b7fff", label: "中速", bubble: "进入状态" };
  if (speed < 60) return { level: 3, state: "fast",    color: "#f59e0b", label: "快速", bubble: "下笔如飞!" };
  return               { level: 4, state: "blazing", color: "#ef4444", label: "飞速", bubble: "爆发中!!!" };
}

function getActivityState(speed, isIdle, mode) {
  if (isIdle) return { text: "暂停中", icon: "pause", cls: "wc-act-idle" };
  if (speed <= 0) return { text: "摸鱼中", icon: "fish", cls: "wc-act-slacking" };
  if (speed < 10) return { text: "摸鱼中", icon: "fish", cls: "wc-act-slacking" };
  if (mode === "coding") return { text: "工作中", icon: "code", cls: "wc-act-working" };
  return { text: "写作中", icon: "pen", cls: "wc-act-writing" };
}

// 气泡提示（不依赖 siyuan.showMessage）
function showToast(msg, duration = 4000) {
  const id = "wc-toast-" + Date.now();
  const el = document.createElement("div");
  el.id = id;
  el.className = "wc-toast";
  el.textContent = msg;
  el.style.cssText = [
    "position:fixed","bottom:24px","left:50%","transform:translateX(-50%)",
    "background:rgba(15,23,42,0.88)","color:#fff","font-size:13px","font-weight:600",
    "padding:8px 18px","border-radius:20px","z-index:99999",
    "box-shadow:0 4px 16px rgba(0,0,0,0.2)",
    "animation:wc-toast-in 0.3s cubic-bezier(0.22,1,0.36,1),wc-toast-out 0.3s ease 2.3s forwards",
    "pointer-events:none","white-space:nowrap",
  ].join(";");
  document.body.appendChild(el);
  // 注入动画样式（单次）
  if (!document.getElementById("wc-toast-style")) {
    const style = document.createElement("style");
    style.id = "wc-toast-style";
    style.textContent = [
      "@keyframes wc-toast-in{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}",
      "@keyframes wc-toast-out{to{opacity:0;transform:translateX(-50%) translateY(-8px)}}",
    ].join("");
    document.head.appendChild(style);
  }
  setTimeout(() => { const e = document.getElementById(id); if (e) e.remove(); }, duration);
}

// 单位换算辅助：内部存 字/分，显示时按需换算
function getSpeedDisplay(speedPerMin, unit) {
  if (speedPerMin <= 0) return "—";
  const MAX_REASONABLE = 500; // 字/分上限（人类打字极限约 300 字/分）
  const capped = Math.min(speedPerMin, MAX_REASONABLE);
  if (unit === "perHour") return Math.round(capped * 60);
  return Math.round(capped);
}
function getSpeedUnit(unit) {
  if (unit === "perHour") return "字/时";
  return "字/分";
}

// 面板主题预设
const PANEL_THEMES = {
  light:  { name: "浅色", dot: "#5b7fff" },
  dark:   { name: "深色", dot: "#475569" },
  eye:    { name: "护眼", dot: "#8fa876" },
};

// 应用面板主题到 DOM 元素
function applyPanelTheme(panelEl, theme) {
  if (!panelEl) return;
  // 移除所有主题类
  Object.keys(PANEL_THEMES).forEach(t => panelEl.classList.remove("wc-theme-" + t));
  // 应用新主题
  panelEl.classList.add("wc-theme-" + theme);
}

// 生成精灵 SVG
// 模式专属图标（写作=笔，编程=</>）
function getModeIcon(mode, state) {
  if (mode === "coding") {
    if (state === "medium") {
      return `
        <g class="wc-code-bracket">
          <text x="40" y="39" font-size="9" fill="#5b9bff" font-weight="700" font-family="monospace">&lt;/&gt;</text>
        </g>`;
    }
    if (state === "fast") {
      return `
        <g class="wc-code-bracket">
          <text x="40" y="39" font-size="9" fill="#f59e0b" font-weight="700" font-family="monospace">&lt;/&gt;</text>
        </g>
        <g class="wc-particle" style="--px:-10px;--py:-14px">
          <circle cx="44" cy="24" r="1.6" fill="#5b9bff" opacity="0.7"/>
        </g>
        <g class="wc-particle" style="--px:-18px;--py:-8px;animation-delay:0.2s">
          <circle cx="48" cy="28" r="1.2" fill="#93c5fd" opacity="0.5"/>
        </g>
        <g class="wc-particle" style="--px:-6px;--py:-20px;animation-delay:0.4s">
          <circle cx="42" cy="20" r="1" fill="#bfdbfe" opacity="0.4"/>
        </g>`;
    }
    if (state === "blazing") {
      return `
        <circle class="wc-face-glow" cx="30" cy="30" r="27" fill="#5b9bff" opacity="0.3"/>
        <g class="wc-code-bracket">
          <text x="39" y="39" font-size="10" fill="#ef4444" font-weight="700" font-family="monospace">&lt;/&gt;</text>
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
        <g class="wc-particle" style="--px:-22px;--py:-6px;animation-delay:0.45s">
          <circle cx="52" cy="30" r="1" fill="#fde68a" opacity="0.4"/>
        </g>
        <g class="wc-sparkle" style="--sx:-12px;--sy:-16px;animation-delay:0.1s">
          <polygon points="42,18 43,16 44,18 42,17 44,17" fill="#fff" opacity="0.7"/>
        </g>
        <g class="wc-sparkle" style="--sx:8px;--sy:-20px;animation-delay:0.35s">
          <polygon points="54,14 55,12 56,14 54,13 56,13" fill="#fff" opacity="0.5"/>
        </g>`;
    }
    return "";
  }
  // 写作模式：笔图标
  if (state === "medium") {
    return `
      <g class="wc-pen">
        <rect x="41" y="30" width="2.5" height="11" rx="1.2" fill="#5b7fff"/>
        <polygon points="41,41 42.25,46 43.5,41" fill="#334155"/>
      </g>`;
  }
  if (state === "fast") {
    return `
      <g class="wc-pen">
        <rect x="41" y="30" width="2.5" height="11" rx="1.2" fill="#f59e0b"/>
        <polygon points="41,41 42.25,46 43.5,41" fill="#334155"/>
      </g>
      <g class="wc-particle" style="--px:-10px;--py:-14px">
        <circle cx="44" cy="24" r="1.6" fill="#f59e0b" opacity="0.7"/>
      </g>
      <g class="wc-particle" style="--px:-18px;--py:-8px;animation-delay:0.2s">
        <circle cx="48" cy="28" r="1.2" fill="#fbbf24" opacity="0.5"/>
      </g>
      <g class="wc-particle" style="--px:-6px;--py:-20px;animation-delay:0.4s">
        <circle cx="42" cy="20" r="1" fill="#fde68a" opacity="0.4"/>
      </g>`;
  }
  if (state === "blazing") {
    return `
      <circle class="wc-face-glow" cx="30" cy="30" r="27" fill="#f87171" opacity="0.3"/>
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
      <g class="wc-particle" style="--px:-22px;--py:-6px;animation-delay:0.45s">
        <circle cx="52" cy="30" r="1" fill="#fde68a" opacity="0.4"/>
      </g>
      <g class="wc-sparkle" style="--sx:-12px;--sy:-16px;animation-delay:0.1s">
        <polygon points="42,18 43,16 44,18 42,17 44,17" fill="#fff" opacity="0.7"/>
      </g>
      <g class="wc-sparkle" style="--sx:8px;--sy:-20px;animation-delay:0.35s">
        <polygon points="54,14 55,12 56,14 54,13 56,13" fill="#fff" opacity="0.5"/>
      </g>`;
  }
  return "";
}

function renderMascotSVG(state, mascotKey, mode) {
  const m = MASCOTS[mascotKey] || MASCOTS.cat;
  const bc = m.body;
  const bl = m.bodyLight;
  const cc = m.cheek;
  const bubbleBg = m.bubbleBg || "rgba(91, 127, 255, 0.85)";
  const bubbleArrow = m.bubbleArrow || "rgba(91, 127, 255, 0.9)";
  const isCoding = mode === "coding";

  const configs = {
    idle: {
      eyes: `
        <line x1="20" y1="28" x2="26" y2="28" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
        <line x1="34" y1="28" x2="40" y2="28" stroke="#334155" stroke-width="2" stroke-linecap="round"/>
      `,
      mouth: `<path d="M24 37 Q30 34 36 37" fill="none" stroke="#334155" stroke-width="1.8" stroke-linecap="round"/>`,
      extra: `
        <g class="wc-zzz">
          <text x="44" y="18" font-size="7" fill="#94a3b8" font-weight="700">z</text>
          <text x="49" y="12" font-size="5.5" fill="#94a3b8" font-weight="700" opacity="0.7">z</text>
          <text x="52" y="8" font-size="4" fill="#94a3b8" font-weight="700" opacity="0.4">z</text>
        </g>
      `,
    },
    slow: {
      eyes: `
        <circle cx="23" cy="28" r="3" fill="#334155"/>
        <circle cx="37" cy="28" r="3" fill="#334155"/>
        <circle cx="24.2" cy="27" r="1" fill="#fff"/>
        <circle cx="38.2" cy="27" r="1" fill="#fff"/>
      `,
      mouth: `<circle cx="30" cy="36" r="1.6" fill="${isCoding ? '#5b9bff' : '#f87171'}"/>`,
      extra: "",
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
      extra: getModeIcon(mode, "medium"),
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
      extra: getModeIcon(mode, "fast"),
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
      extra: getModeIcon(mode, "blazing"),
    },
  };

  const cfg = configs[state] || configs.idle;
  const horn = m.horn || "";
  const wing = m.wing || "";

  return {
    svg: `
      <svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" style="color:${bc}">
        <circle cx="30" cy="30" r="27" fill="${bc}" opacity="0.08"/>
        ${wing}
        <circle cx="30" cy="30" r="21" fill="${bc}"/>
        <ellipse cx="24" cy="22" rx="8" ry="4.5" fill="${bl}" opacity="0.4" transform="rotate(-15 24 22)"/>
        ${horn}
        ${m.ears}
        ${cfg.eyes}
        ${cfg.mouth}
        <circle cx="17" cy="34" r="4" fill="${cc}" opacity="0.5"/>
        ${cfg.extra}
        ${m.tail}
      </svg>
    `,
    bubbleBg: bubbleBg,
    bubbleArrow: bubbleArrow,
  };
}

// ============ 主插件类 ============
class WordCounterPlugin extends siyuan.Plugin {
  constructor() {
    super(...arguments);
    this.statusEl = null;
    this.panelEl = null;
    this.panelVisible = false;
    this.settingsEl = null;
    this.settingsVisible = false;
    this.sampleTimer = null;
    this.dailyData = {};
    this.lastWordCount = 0;        // 基准字数（编辑器加载时校准）
    this.lastSampleTime = 0;
    this.currentSpeed = 0;         // 实时速率（EMA平滑）
    this.lastInputTime = 0;
    this.isIdle = false;
    this._boundHandleInput = null;
    this.panelTimer = null;
    this._prevTotalWords = -1;
    this._dragging = false;
    this._dragOffset = { x: 0, y: 0 };
    this._lastPanelPos = null;       // 主面板位置
    this._miniLastPos = null;        // mini 面板位置（独立记忆）
    this._interactTimer = null;
    this._activityTimer = null;
    this._writingSessionStart = 0;
    this._lastMascotState = "idle";
    this._mascotStateSince = 0;
    // 可拖动最小化浮层面板（独立于 Siyuan 状态栏）
    this._miniPanelEl = null;
    this._miniDraggable = false;
    this._miniDragOffset = { x: 0, y: 0 };
    this._miniDragStart = null;
    this._miniDragMoved = false;
    this.settings = {
      targetWordsEnabled: false,
      targetWords: 3000,
      targetMinutesEnabled: false,
      targetMinutes: 120,
      mode: "writing",
      mascot: "cat",
      speedUnit: "perMin",      // "perMin" | "perHour"
      panelTheme: "light",       // 面板主题: light/dark/eye
      firstUseShown: false,      // 是否已展示过启动气泡
    };

    // ========== 目标完成追踪 ==========
    this._wordsGoalReached = false;
    this._timeGoalReached = false;

    // ========== 滑动窗口 ==========
    this._speedWindow = [];
    this._windowTotalWords = 0;
    this._prevDisplayedSpeed = 0;
    this._uiUpdateScheduled = false;

    // ========== 爆发检测 ==========
    this._instantWindow = [];
    this._instantTotalWords = 0;
    this._lastBurstTime = 0;
  }

  async onload() {
    this._boundHandleInput = () => this.handleInput();
    await this.loadData();
    await this.loadSettings();

    // 立即校准基准字数：用当前编辑器已有内容作为基准，避免已有文本被误算为"今日新增"
    this.lastWordCount = this.countByMode(getEditorText());

    this.initStatusBar();
    // 应用面板主题到状态栏（initStatusBar 后才有效）
    applyPanelTheme(this.statusEl, this.settings.panelTheme);
    this.startSampling();
    this.bindEvents();

    // 首次使用气泡引导
    if (!this.settings.firstUseShown) {
      setTimeout(() => {
        showToast("👋 点右下角「码字统计」查看面板");
      }, 1200);
      this.settings.firstUseShown = true;
      this.saveSettings();
    } else {
      // 非首次启动，轻提示位置
      setTimeout(() => {
        showToast("📌 码字统计已就绪");
      }, 800);
    }
  }

  onunload() {
    this.saveDataSync();
    if (this.sampleTimer) { clearInterval(this.sampleTimer); this.sampleTimer = null; }
    if (this.panelTimer) { clearInterval(this.panelTimer); this.panelTimer = null; }
    if (this._docPollTimer) { clearInterval(this._docPollTimer); this._docPollTimer = null; }
    if (this._interactTimer) { clearTimeout(this._interactTimer); this._interactTimer = null; }
    if (this._activityTimer) { clearInterval(this._activityTimer); this._activityTimer = null; }
    this.unbindEvents();
    this.hidePanel();
    this.hideSettings();
    // 清理 mini 浮层面板，防止插件重载后残留
    if (this._miniDragCleanup) { this._miniDragCleanup(); this._miniDragCleanup = null; }
    if (this.statusEl && this.statusEl.parentNode) {
      this.statusEl.parentNode.removeChild(this.statusEl);
      this.statusEl = null;
    }
  }

  onLayoutReady() {}

  // ============ 数据持久化 ============
  /**
   * 数据结构（累积模式，全局共享）：
   * {
   *   "2026-04-17": { totalWords, peakAvgSpeed, writingTime, idleTime, startTime },
   *   lastDate: "2026-04-17"
   * }
   */
  async loadData() {
    const today = getTodayStr();
    const defaultData = {
      [today]: { totalWords: 0, peakAvgSpeed: 0, writingTime: 0, idleTime: 0, startTime: null },
      lastDate: today,
    };
    try {
      const saved = await super.loadData(STORAGE_KEY);
      if (saved && typeof saved === "object") {
        this.dailyData = saved;
        if (!this.dailyData[today]) {
          this.dailyData[today] = defaultData[today];
          this.dailyData.lastDate = today;
        } else {
          this.dailyData.lastDate = today;
        }
      } else {
        this.dailyData = defaultData;
      }
    } catch (e) {
      console.warn("[码字统计] 加载数据失败", e);
      this.dailyData = defaultData;
    }
  }

  async saveData() {
    this.dailyData.lastDate = getTodayStr();
    try { await super.saveData(STORAGE_KEY, this.dailyData); }
    catch (e) { console.warn("[码字统计] 保存数据失败", e); }
  }

  saveDataSync() { this.saveData(); }

  async loadSettings() {
    try {
      const saved = await super.loadData(SETTINGS_KEY);
      if (saved && typeof saved === "object") {
        this.settings = {
          targetWordsEnabled: false,
          targetWords: 3000,
          targetMinutesEnabled: false,
          targetMinutes: 120,
          mode: "writing",
          mascot: "cat",
          speedUnit: "perMin",
          panelTheme: "light",
          firstUseShown: false,
          ...saved,
          targetWordsEnabled: !!saved.targetWordsEnabled,
          targetMinutesEnabled: !!saved.targetMinutesEnabled,
          speedUnit: (saved.speedUnit === "perHour") ? "perHour" : "perMin",
          panelTheme: ["light", "dark", "eye"].includes(saved.panelTheme) ? saved.panelTheme : "light",
        };
      }
    } catch (e) {
      console.warn("[码字统计] 加载设置失败", e);
    }
  }

  async saveSettings() {
    try { await super.saveData(SETTINGS_KEY, this.settings); }
    catch (e) { console.warn("[码字统计] 保存设置失败", e); }
  }

  getTodayData() {
    const today = getTodayStr();
    if (!this.dailyData[today]) {
      this.dailyData[today] = { totalWords: 0, peakAvgSpeed: 0, writingTime: 0, idleTime: 0, startTime: null };
      this.dailyData.lastDate = today;
    }
    return this.dailyData[today];
  }

  countByMode(text) {
    return this.settings.mode === "coding" ? countWordsCoding(text) : countWordsWriting(text);
  }

  // ============ 最小化浮层面板（可拖动） ============
  initStatusBar() {
    // 防重复：如果已存在则先移除
    const existing = document.querySelector(".wc-mini-panel");
    if (existing) existing.remove();

    // 创建可拖动浮层面板（替代 Siyuan 状态栏）
    this.statusEl = document.createElement("div");
    this.statusEl.className = "wc-mini-panel wc-theme-" + (this.settings.panelTheme || "light");
    this.statusEl.innerHTML = this.renderMiniPanelHTML(0, 0);
    this.statusEl.title = "码字统计 - 点击展开详情";
    document.body.appendChild(this.statusEl);
    this.positionMiniPanel();
    this.bindMiniPanelDrag();
    this.statusEl.addEventListener("click", (e) => {
      e.stopPropagation();
      // 只有非拖动状态才触发展开/收起
      if (this._miniDragMoved) {
        this._miniDragMoved = false;
        return;
      }
      this.togglePanel();
    });
  }

  renderMiniPanelHTML(avgSpeed, totalWords) {
    const todayData = this.getTodayData();
    const displaySpeed = todayData.writingTime >= 30 ? avgSpeed : 0;
    const info = getSpeedLevel(displaySpeed);
    const unit = this.settings.speedUnit || "perMin";
    const speedText = getSpeedDisplay(displaySpeed, unit);
    const speedUnit = unit === "perHour" ? "字/时" : "字/分";
    const ml = MODE_LABELS[this.settings.mode];
    return `
      <div class="wc-mini-plugin-name">📝 码字统计</div>
      <div class="wc-mini-inner">
        <span class="wc-mini-dot" style="background:${info.color}"></span>
        <span class="wc-mini-speed" style="color:${info.color}">${speedText}</span>
        <span class="wc-mini-unit">${speedUnit}</span>
        <span class="wc-mini-sep">|</span>
        <span class="wc-mini-total">${formatNumber(totalWords)}</span>
        <span class="wc-mini-unit">${ml.wordUnit}</span>
      </div>
    `;
  }

  positionMiniPanel() {
    if (!this.statusEl) return;
    if (this._miniLastPos) {
      this.statusEl.style.left = this._miniLastPos.left + "px";
      this.statusEl.style.top = this._miniLastPos.top + "px";
      this.statusEl.style.right = "auto";
      this.statusEl.style.bottom = "auto";
      return;
    }
    // 默认右下角
    this.statusEl.style.right = "24px";
    this.statusEl.style.bottom = "80px";
    this.statusEl.style.left = "auto";
    this.statusEl.style.top = "auto";
  }

  bindMiniPanelDrag() {
    const el = this.statusEl;
    if (!el) return;

    // 防重复：先清理旧的 document 级监听
    if (this._miniDragCleanup) { this._miniDragCleanup(); }

    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._miniDragStart = { x: e.clientX, y: e.clientY };
      this._miniDraggable = true;
      const rect = el.getBoundingClientRect();
      this._miniDragOffset.x = e.clientX - rect.left;
      this._miniDragOffset.y = e.clientY - rect.top;
      el.style.cursor = "grabbing";
    });

    const onMove = (e) => {
      if (!this._miniDraggable) return;
      const x = e.clientX - this._miniDragOffset.x;
      const y = e.clientY - this._miniDragOffset.y;
      el.style.left = Math.max(0, x) + "px";
      el.style.top = Math.max(0, y) + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      // 拖动超过阈值就标记为非点击
      if (this._miniDragStart) {
        const dx = e.clientX - this._miniDragStart.x;
        const dy = e.clientY - this._miniDragStart.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          this._miniDragMoved = true;
        }
      }
    };

    const onUp = () => {
      if (!this._miniDraggable) return;
      this._miniDraggable = false;
      el.style.cursor = "pointer";
      this._miniDragStart = null;
      // 记录 mini 面板位置（独立于主面板）
      const rect = el.getBoundingClientRect();
      this._miniLastPos = { left: rect.left, top: rect.top };
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    this._miniDragCleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }

  updateStatusBar() {
    if (!this.statusEl) return;
    const todayData = this.getTodayData();
    const avgSpeed = this._getCalibratedAvgSpeed();
    this.statusEl.innerHTML = this.renderMiniPanelHTML(avgSpeed, todayData.totalWords);
  }

  // ============ 浮动面板 ============
  togglePanel() {
    if (this.panelVisible) this.hidePanel();
    else this.showPanel();
  }

  showPanel() {
    if (this.panelEl) this.hidePanel();

    // 隐藏 mini 面板
    if (this.statusEl) this.statusEl.style.display = "none";

    this.panelEl = document.createElement("div");
    this.panelEl.className = "wordcounter-panel wc-theme-" + (this.settings.panelTheme || "light");
    this.panelEl.innerHTML = this.renderPanelHTML();
    this.panelEl.style.display = "block";

    // 重置 bump 动画追踪，避免关闭期间的数据变化触发无效动画
    this._prevTotalWords = this.getTodayData().totalWords;

    this.positionPanel();
    document.body.appendChild(this.panelEl);
    this.panelVisible = true;

    this.startPanelUpdate();
    this.startActivityCycle();
    this.bindResetBtn();
    this.bindMinimizeBtn();
    this.bindSettingsBtn();
    this.bindDrag();
    this.bindMascotInteract();

    this.panelEl.addEventListener("click", (e) => e.stopPropagation());
  }

  hidePanel() {
    if (this.panelEl && this.panelEl.parentNode) {
      this.panelEl.parentNode.removeChild(this.panelEl);
    }
    this.panelEl = null;
    this.panelVisible = false;
    this.stopPanelUpdate();
    this.stopActivityCycle();
    this._dragging = false;
    // 清理 document 上的拖拽监听，防止重复绑定
    if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
    // 恢复 mini 面板
    if (this.statusEl) {
      this.statusEl.style.display = "";
    }
  }

  positionPanel() {
    if (!this.panelEl) return;
    const panelWidth = 340;

    // 如果有上次记忆的位置，直接恢复
    if (this._lastPanelPos) {
      let { left, top } = this._lastPanelPos;
      // 边界修正（防止窗口缩放后跑出去）
      if (left < 8) left = 8;
      if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
      if (top < 8) top = 8;
      if (top > window.innerHeight - 80) top = window.innerHeight - 80;
      this.panelEl.style.left = left + "px";
      this.panelEl.style.top = top + "px";
      return;
    }

    // 首次弹出：基于状态栏位置定位，右下角偏上
    if (this.statusEl) {
      const rect = this.statusEl.getBoundingClientRect();
      // 先用估算高度定位，挂载后再精确修正
      const estimatedHeight = 420;
      let left = rect.left + rect.width / 2 - panelWidth / 2;
      let top = rect.top - estimatedHeight - 8;

      if (left < 8) left = 8;
      if (left + panelWidth > window.innerWidth - 8) left = window.innerWidth - panelWidth - 8;
      if (top < 8) top = rect.bottom + 8;

      this.panelEl.style.left = left + "px";
      this.panelEl.style.top = top + "px";

      // DOM 渲染后精确修正
      requestAnimationFrame(() => {
        if (!this.panelEl) return;
        const realHeight = this.panelEl.offsetHeight;
        if (realHeight > 0) {
          let t = rect.top - realHeight - 8;
          if (t < 8) t = rect.bottom + 8;
          this.panelEl.style.top = t + "px";
        }
      });
    } else {
      // fallback：右下角
      this.panelEl.style.right = "24px";
      this.panelEl.style.bottom = "60px";
    }
  }

  renderPanelHTML() {
    const todayData = this.getTodayData();
    const avgSpeed = this._getCalibratedAvgSpeed();
    const avgInfo = getSpeedLevel(avgSpeed);
    const ml = MODE_LABELS[this.settings.mode];
    const speed = this.isIdle ? 0 : this.currentSpeed;
    const act = getActivityState(speed, this.isIdle, this.settings.mode);

    const wMins = Math.floor(todayData.writingTime / 60);
    const wTimeStr = formatMinutes(todayData.writingTime);
    const iTimeStr = formatMinutes(todayData.idleTime);
    const totalWords = todayData.totalWords;
    const peakSpeed = todayData.peakAvgSpeed || 0;

    // 目标进度
    const wordsPercent = (this.settings.targetWordsEnabled && this.settings.targetWords > 0)
      ? Math.min(100, (totalWords / this.settings.targetWords) * 100) : 0;
    const timePercent = (this.settings.targetMinutesEnabled && this.settings.targetMinutes > 0)
      ? Math.min(100, (wMins / this.settings.targetMinutes) * 100) : 0;

    const mascot = this.settings.mascot || "cat";
    const mode = this.settings.mode || "writing";
    const mascotData = renderMascotSVG(avgInfo.state, mascot, mode);

    return `
      <div class="wc-panel-header" id="wc-drag-handle">
        <span class="wc-panel-title">${ml.name}</span>
        <div class="wc-panel-header-actions">
          <span class="wc-panel-date">${getTodayStr()}</span>
          <button class="wc-settings-btn" id="wc-settings-btn" title="设置">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
              <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
            </svg>
          </button>
          <button class="wc-minimize-btn" id="wc-minimize-btn" title="最小化">
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>

      <!-- Hero 背景区 -->
      <div class="wc-hero-bg" data-speed="${avgInfo.state}">
        <div class="wc-panel-hero">
          <!-- 精灵（左侧） -->
          <div class="wc-hero-mascot" style="--mascot-bubble-bg:${mascotData.bubbleBg};--mascot-bubble-arrow:${mascotData.bubbleArrow}">
            <div class="wc-mascot" id="wc-mascot" data-state="${avgInfo.state}" data-mascot="${mascot}">
              ${mascotData.svg}
            </div>
            <span class="wc-mascot-bubble wc-bubble-show" id="wc-mascot-bubble">${avgInfo.bubble}</span>
          </div>

          <!-- 两列数据：今日字数（大字居中）+ 平均速率 -->
          <div class="wc-hero-data">
            <!-- 今日字数（居中大字） -->
            <div class="wc-hero-col-words">
              <span class="wc-hero-num wc-words-num" id="wc-hero-words-num">${formatNumber(totalWords)}</span>
              <span class="wc-hero-label">${ml.wordUnit}</span>
            </div>

            <!-- 平均速率 -->
            <div class="wc-hero-col-avg">
              <span class="wc-hero-num wc-avg-num" id="wc-hero-avg-num">${avgSpeed ? getSpeedDisplay(avgSpeed, this.settings.speedUnit) : "—"}</span>
              <span class="wc-hero-sub wc-avg-sub">${avgInfo.label}</span>
              <span class="wc-hero-label">${getSpeedUnit(this.settings.speedUnit)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 目标进度条（可独立开关） -->
      <div class="wc-goals-section">
        <div class="wc-goal-row ${this.settings.targetWordsEnabled ? '' : 'wc-goal-disabled'}" id="wc-goal-words-row">
          <div class="wc-toggle-track ${this.settings.targetWordsEnabled ? 'wc-toggle-on' : ''}" id="wc-toggle-words" title="字数目标开关">
            <div class="wc-toggle-thumb"></div>
          </div>
          <div class="wc-goal-info">
            <span class="wc-goal-label">${ml.wordUnit}数目标</span>
            <span class="wc-goal-value">${totalWords}<span class="wc-goal-sep">/</span>${formatNumber(this.settings.targetWords)}</span>
          </div>
          <div class="wc-goal-bar">
            <div class="wc-goal-fill wc-goal-fill-words ${wordsPercent >= 100 ? 'wc-goal-done' : ''}" style="width:${wordsPercent}%"></div>
          </div>
          <span class="wc-goal-pct">${Math.round(wordsPercent)}%</span>
        </div>
        <div class="wc-goal-row ${this.settings.targetMinutesEnabled ? '' : 'wc-goal-disabled'}" id="wc-goal-time-row">
          <div class="wc-toggle-track ${this.settings.targetMinutesEnabled ? 'wc-toggle-on' : ''}" id="wc-toggle-time" title="时长目标开关">
            <div class="wc-toggle-thumb"></div>
          </div>
          <div class="wc-goal-info">
            <span class="wc-goal-label">时长目标</span>
            <span class="wc-goal-value">${wTimeStr}<span class="wc-goal-sep">/</span>${this.settings.targetMinutes}m</span>
          </div>
          <div class="wc-goal-bar">
            <div class="wc-goal-fill wc-goal-fill-time ${timePercent >= 100 ? 'wc-goal-done' : ''}" style="width:${timePercent}%"></div>
          </div>
          <span class="wc-goal-pct">${Math.round(timePercent)}%</span>
        </div>
      </div>

      <!-- 指标卡片 3列 -->
      <div class="wc-panel-metrics">
        <div class="wc-metric-card wc-metric-peak">
          <span class="wc-metric-num">${getSpeedDisplay(peakSpeed, this.settings.speedUnit)}</span>
          <span class="wc-metric-label">峰值</span>
        </div>
        <div class="wc-metric-card wc-metric-write">
          <span class="wc-metric-num">${wTimeStr}</span>
          <span class="wc-metric-label">写作</span>
        </div>
        <div class="wc-metric-card wc-metric-rest">
          <span class="wc-metric-num">${iTimeStr}</span>
          <span class="wc-metric-label">休息</span>
        </div>
      </div>

      <!-- 底部状态 + 重置 -->
      <div class="wc-panel-bottom">
        <div class="wc-panel-status" id="wc-activity-status">
          <span class="wc-status-dot ${this.isIdle ? "" : "wc-dot-active"}" style="background:${this.isIdle ? "#94a3b8" : avgInfo.color}"></span>
          <span class="wc-status-text ${act.cls}">${act.text}</span>
        </div>
        <button class="wc-reset-btn" id="wc-reset-btn">重置</button>
      </div>
    `;
  }

  // ============ 面板内目标开关交互 ============
  bindGoalToggles() {
    if (!this.panelEl) return;

    const wordsToggle = this.panelEl.querySelector("#wc-toggle-words");
    const timeToggle = this.panelEl.querySelector("#wc-toggle-time");
    const wordsRow = this.panelEl.querySelector("#wc-goal-words-row");
    const timeRow = this.panelEl.querySelector("#wc-goal-time-row");

    if (wordsToggle) {
      wordsToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.settings.targetWordsEnabled = !this.settings.targetWordsEnabled;
        wordsToggle.classList.toggle("wc-toggle-on", this.settings.targetWordsEnabled);
        if (wordsRow) {
          wordsRow.classList.toggle("wc-goal-disabled", !this.settings.targetWordsEnabled);
          // 同步开关样式
          wordsRow.querySelectorAll(".wc-toggle-track").forEach(t => {
            t.classList.toggle("wc-toggle-on", this.settings.targetWordsEnabled);
          });
        }
        this.saveSettings();
      });
    }
    if (timeToggle) {
      timeToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        this.settings.targetMinutesEnabled = !this.settings.targetMinutesEnabled;
        timeToggle.classList.toggle("wc-toggle-on", this.settings.targetMinutesEnabled);
        if (timeRow) {
          timeRow.classList.toggle("wc-goal-disabled", !this.settings.targetMinutesEnabled);
          timeRow.querySelectorAll(".wc-toggle-track").forEach(t => {
            t.classList.toggle("wc-toggle-on", this.settings.targetMinutesEnabled);
          });
        }
        this.saveSettings();
      });
    }
  }

  // ============ 活动状态循环 ============
  startActivityCycle() {
    this.stopActivityCycle();
    this._activityTimer = setInterval(() => {
      this._updateActivityStatus();
    }, 3000);
  }

  stopActivityCycle() {
    if (this._activityTimer) { clearInterval(this._activityTimer); this._activityTimer = null; }
  }

  _updateActivityStatus() {
    if (!this.panelEl || !this.panelVisible) return;
    const speed = this.isIdle ? 0 : this.currentSpeed;
    const act = getActivityState(speed, this.isIdle, this.settings.mode);

    let displayText = act.text;
    if (act.icon === "fish") {
      const variants = ["摸鱼中", "发呆中", "走神中", "摸鱼~", "咸鱼中"];
      displayText = variants[Math.floor(Math.random() * variants.length)];
    }
    if (act.icon === "pen" && speed >= 30) {
      const variants = ["写作中", "奋笔疾书!", "灵感爆发!", "妙笔生花!"];
      displayText = variants[Math.floor(Math.random() * variants.length)];
    }
    if (act.icon === "code" && speed >= 30) {
      const variants = ["工作中", "键盘着火!", "代码飞舞!", "高效输出!"];
      displayText = variants[Math.floor(Math.random() * variants.length)];
    }

    const statusText = this.panelEl.querySelector(".wc-status-text");
    const statusDot = this.panelEl.querySelector(".wc-status-dot");
    const info = getSpeedLevel(speed);

    if (statusText) {
      statusText.textContent = displayText;
      statusText.className = "wc-status-text " + act.cls;
    }
    if (statusDot) {
      statusDot.style.background = this.isIdle ? "#94a3b8" : info.color;
      statusDot.className = "wc-status-dot";
      if (!this.isIdle) {
        if (info.state === "fast") statusDot.classList.add("wc-dot-fast");
        else if (info.state === "blazing") statusDot.classList.add("wc-dot-blazing");
        else if (speed >= 10) statusDot.classList.add("wc-dot-active");
      }
    }
  }

  startPanelUpdate() {
    this.stopPanelUpdate();
    this.panelTimer = setInterval(() => {
      if (this.panelEl && this.panelVisible) this.updatePanelContent();
    }, 500);
  }

  updatePanelContent() {
    if (!this.panelEl) return;
    const todayData = this.getTodayData();
    const avgSpeed = this._getCalibratedAvgSpeed();
    const avgInfo = getSpeedLevel(avgSpeed);

    // ---- 精灵状态更新 ----
    const mascot = this.panelEl.querySelector("#wc-mascot");
    const targetState = this._lastMascotState;
    if (mascot && mascot.dataset.state !== targetState) {
      if (!mascot.classList.contains("wc-mascot-interact")) {
        mascot.dataset.state = targetState;
        const svgEl = mascot.querySelector("svg");
        if (svgEl) {
          const mascotData = renderMascotSVG(targetState, this.settings.mascot || "cat", this.settings.mode || "writing");
          svgEl.outerHTML = mascotData.svg;
          const heroMascot = this.panelEl.querySelector(".wc-hero-mascot");
          if (heroMascot) {
            heroMascot.style.setProperty("--mascot-bubble-bg", mascotData.bubbleBg);
            heroMascot.style.setProperty("--mascot-bubble-arrow", mascotData.bubbleArrow);
          }
        }
      }
      const bubble = this.panelEl.querySelector("#wc-mascot-bubble");
      if (bubble && !mascot.classList.contains("wc-mascot-interact")) {
        bubble.textContent = avgInfo.bubble;
      }
    }

    // ---- Hero 背景 ----
    const heroBg = this.panelEl.querySelector(".wc-hero-bg");
    if (heroBg) heroBg.dataset.speed = targetState;

    // ---- 今日字数 ----
    const wordsNumEl = this.panelEl.querySelector("#wc-hero-words-num");
    if (wordsNumEl) {
      const newText = formatNumber(todayData.totalWords);
      if (this._prevTotalWords >= 0 && todayData.totalWords !== this._prevTotalWords) {
        wordsNumEl.classList.remove("wc-num-bump");
        void wordsNumEl.offsetWidth;
        wordsNumEl.classList.add("wc-num-bump");
      }
      wordsNumEl.textContent = newText;
      this._prevTotalWords = todayData.totalWords;
    }

    // ---- 平均速率 ----
    const avgNumEl = this.panelEl.querySelector("#wc-hero-avg-num");
    if (avgNumEl) {
      avgNumEl.textContent = avgSpeed ? getSpeedDisplay(avgSpeed, this.settings.speedUnit) : "—";
    }
    const avgSubEl = this.panelEl.querySelector(".wc-hero-col-avg .wc-hero-sub");
    if (avgSubEl) {
      avgSubEl.textContent = avgInfo.label;
    }

    // ---- 目标进度 ----
    const docWTime = todayData.writingTime;
    const docTotalWords = todayData.totalWords;
    const wMins = Math.floor(docWTime / 60);
    const wordsPercent = (this.settings.targetWordsEnabled && this.settings.targetWords > 0)
      ? Math.min(100, (docTotalWords / this.settings.targetWords) * 100) : 0;
    const timePercent = (this.settings.targetMinutesEnabled && this.settings.targetMinutes > 0)
      ? Math.min(100, (wMins / this.settings.targetMinutes) * 100) : 0;

    const goalRows = this.panelEl.querySelectorAll(".wc-goal-row");
    if (goalRows[0]) {
      const val = goalRows[0].querySelector(".wc-goal-value");
      const fill = goalRows[0].querySelector(".wc-goal-fill-words");
      const pct = goalRows[0].querySelector(".wc-goal-pct");
      goalRows[0].classList.toggle("wc-goal-disabled", !this.settings.targetWordsEnabled);
      if (val) val.innerHTML = `${docTotalWords}<span class="wc-goal-sep">/</span>${formatNumber(this.settings.targetWords)}`;
      if (this.settings.targetWordsEnabled && this.settings.targetWords > 0) {
        if (fill) { fill.style.width = wordsPercent + "%"; fill.classList.toggle("wc-goal-done", wordsPercent >= 100); }
        if (pct) pct.textContent = Math.round(wordsPercent) + "%";
      } else {
        if (fill) { fill.style.width = "0%"; }
        if (pct) pct.textContent = "—";
      }
    }
    if (goalRows[1]) {
      const val = goalRows[1].querySelector(".wc-goal-value");
      const fill = goalRows[1].querySelector(".wc-goal-fill-time");
      const pct = goalRows[1].querySelector(".wc-goal-pct");
      goalRows[1].classList.toggle("wc-goal-disabled", !this.settings.targetMinutesEnabled);
      if (val) val.innerHTML = `${formatMinutes(docWTime)}<span class="wc-goal-sep">/</span>${this.settings.targetMinutes}m`;
      if (this.settings.targetMinutesEnabled && this.settings.targetMinutes > 0) {
        if (fill) { fill.style.width = timePercent + "%"; fill.classList.toggle("wc-goal-done", timePercent >= 100); }
        if (pct) pct.textContent = Math.round(timePercent) + "%";
      } else {
        if (fill) { fill.style.width = "0%"; }
        if (pct) pct.textContent = "—";
      }
    }

    // ---- 指标卡片 ----
    const docITime = todayData.idleTime;
    const docPeakSpeed = todayData.peakAvgSpeed || 0;
    const metricNums = this.panelEl.querySelectorAll(".wc-metric-num");
    const wTimeStr = formatMinutes(docWTime);
    const iTimeStr = formatMinutes(docITime);
    if (metricNums[0]) metricNums[0].textContent = getSpeedDisplay(docPeakSpeed, this.settings.speedUnit);
    if (metricNums[1]) metricNums[1].textContent = wTimeStr;
    if (metricNums[2]) metricNums[2].textContent = iTimeStr;

    // ---- 状态栏 ----
    this._updateActivityStatus();

    // ---- 目标完成检测 ----
    this._checkGoalCompletion(wordsPercent, timePercent);
  }

  /**
   * 检测目标完成并触发动画和通知
   */
  _checkGoalCompletion(wordsPercent, timePercent) {
    const ml = MODE_LABELS[this.settings.mode];

    // 字数目标完成检测（从未完成 -> 完成）
    if (this.settings.targetWordsEnabled && this.settings.targetWords > 0) {
      const justCompleted = wordsPercent >= 100 && !this._wordsGoalReached;
      if (justCompleted) {
        this._wordsGoalReached = true;
        this._triggerGoalDone("words", this.settings.targetWords, ml.wordUnit);
      }
    } else {
      // 目标被禁用时重置状态
      this._wordsGoalReached = false;
    }

    // 时长目标完成检测（从未完成 -> 完成）
    if (this.settings.targetMinutesEnabled && this.settings.targetMinutes > 0) {
      const justCompleted = timePercent >= 100 && !this._timeGoalReached;
      if (justCompleted) {
        this._timeGoalReached = true;
        this._triggerGoalDone("time", this.settings.targetMinutes, "分钟");
      }
    } else {
      // 目标被禁用时重置状态
      this._timeGoalReached = false;
    }
  }

  /**
   * 触发目标完成动画和通知
   */
  _triggerGoalDone(type, target, unit) {
    const panelEl = this.panelEl;
    if (!panelEl) return;

    const row = panelEl.querySelector(type === "words" ? "#wc-goal-words-row" : "#wc-goal-time-row");
    const fill = panelEl.querySelector(type === "words" ? ".wc-goal-fill-words" : ".wc-goal-fill-time");

    if (fill) {
      // 触发动画
      fill.classList.remove("wc-goal-done-anim");
      void fill.offsetWidth;
      fill.classList.add("wc-goal-done-anim");
    }

    if (row) {
      row.classList.add("wc-goal-done-row");
      setTimeout(() => row.classList.remove("wc-goal-done-row"), 2000);
    }

    // 气泡通知
    const msgs = type === "words"
      ? [`🎯 字数目标达成！${target}${unit}`, `💪 写满${target}${unit}！`, `🏆 ${target}${unit}达成！`]
      : [`⏰ 时长目标达成！${target}${unit}`, `⏱️ 专注${target}${unit}！`, `🏆 时长目标完成！`];
    const msg = msgs[Math.floor(Math.random() * msgs.length)];
    showToast(msg, 4000);
  }

  stopPanelUpdate() {
    if (this.panelTimer) { clearInterval(this.panelTimer); this.panelTimer = null; }
  }

  // ============ 设置面板 ============
  bindSettingsBtn() {
    if (!this.panelEl) return;
    const btn = this.panelEl.querySelector("#wc-settings-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleSettings();
      });
    }
  }

  toggleSettings() {
    if (this.settingsVisible) this.hideSettings();
    else this.showSettings();
  }

  showSettings() {
    this.hideSettings();
    const ml = MODE_LABELS[this.settings.mode];
    const currentTheme = this.settings.panelTheme || "light";
    this.settingsEl = document.createElement("div");
    this.settingsEl.className = "wc-settings-overlay wc-theme-" + currentTheme;
    this.settingsEl.innerHTML = `
      <div class="wc-settings-dialog wc-theme-${currentTheme}">
        <div class="wc-settings-header">
          <span class="wc-settings-title">设置</span>
          <button class="wc-settings-close" id="wc-settings-close">✕</button>
        </div>
        <div class="wc-settings-body">
          <!-- 模式切换 -->
          <div class="wc-settings-group">
            <label class="wc-settings-label">
              <span>监测模式</span>
              <span class="wc-settings-hint">码字模式按中文字数+英文词数统计；编程模式按总字符数统计</span>
            </label>
            <div class="wc-settings-mode-btns">
              <button class="wc-mode-btn wc-mode-selector ${this.settings.mode === 'writing' ? 'wc-mode-active' : ''}" data-mode="writing">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.854.146a.5.5 0 0 0-.708 0L9.5 2.793 5.854.146a.5.5 0 1 0-.708.708L8.793 3.5 4.5 7.793.146 4.146a.5.5 0 0 0-.708.708L3.5 8.793.146 12.146a.5.5 0 0 0 .708.708L8.793 4.5l3.646 3.646a.5.5 0 0 0 .708-.708L9.207 3.793 12.854.146z"/></svg>
                码字模式
              </button>
              <button class="wc-mode-btn wc-mode-selector ${this.settings.mode === 'coding' ? 'wc-mode-active' : ''}" data-mode="coding">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 7a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM 8 6a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z"/><path d="M9.5 8h-5l-1 1H2V5h1.5l1-1h5l.5.5V8zm-7.224 3.63a.5.5 0 0 1-.638-.765L3.59 9.5H6.5l-1 1h-5l.75-.75L3.4 12.5a.5.5 0 0 1-.765-.638L4.12 10l-1.485-1.635a.5.5 0 0 1 .765-.638L5 9.25h2.5l.75.75V8h.5l.75-.75H12v2h-1.5l.5.5 1.135-1.135a.5.5 0 0 1 .638.765L11.38 12l1.485 1.635a.5.5 0 0 1-.638.765L10.5 13H8v1h2v-1h.5l-1-1h2.5l-1-1H8.5l-1-1H6.5l-1 1h2.5l-1 1H6v1H4.5V13H6l1 1h3.5l-1 1H6.5l-.5.5V16h5v-1.5l.5-.5h2.5l.5.5V16h1v-1.5l-.5-.5H13.5l.5-.5h2l1 1h.5V13h-.5l-1-1h-2.5l-.5-.5H13l.5-.5h-1L11 9.5h2l.5.5V10h1V8.5l-.5-.5H12l.5-.5H11l-.5-.5h-1l.5-.5H8l.5.5H6.5l.5.5H5l.5.5H4v1h.5l-.5.5H2.276z"/></svg>
                编程模式
              </button>
            </div>
          </div>

          <!-- 速率单位切换 -->
          <div class="wc-settings-group">
            <label class="wc-settings-label">
              <span>速率单位</span>
              <span class="wc-settings-hint">切换实时速率和平均速率的显示单位</span>
            </label>
            <div class="wc-settings-mode-btns">
              <button class="wc-mode-btn wc-unit-btn ${this.settings.speedUnit !== 'perHour' ? 'wc-mode-active' : ''}" id="wc-speed-unit-min" data-unit="perMin">
                字/分
              </button>
              <button class="wc-mode-btn wc-unit-btn ${this.settings.speedUnit === 'perHour' ? 'wc-mode-active' : ''}" id="wc-speed-unit-hour" data-unit="perHour">
                字/时
              </button>
            </div>
          </div>

          <!-- 面板主题选择 -->
          <div class="wc-settings-group">
            <label class="wc-settings-label">
              <span>面板配色</span>
              <span class="wc-settings-hint">选择面板背景色</span>
            </label>
            <div class="wc-settings-theme-btns">
              ${Object.entries(PANEL_THEMES).map(([key, theme]) => `
                <button class="wc-theme-btn ${this.settings.panelTheme === key ? 'wc-theme-active' : ''}"
                        data-theme="${key}" title="${theme.name}">
                  <span class="wc-theme-btn-dot" style="background:${theme.dot};width:12px;height:12px;border-radius:50%;flex-shrink:0"></span>
                  ${theme.name}
                </button>
              `).join("")}
            </div>
          </div>

          <!-- 角色选择 -->
          <div class="wc-settings-group">
            <label class="wc-settings-label">
              <span>精灵形象</span>
              <span class="wc-settings-hint">点击切换你的写作伴侣</span>
            </label>
            <div class="wc-settings-mascot-grid">
              ${Object.entries(MASCOTS).map(([key, m]) => {
                const mascotData = renderMascotSVG("medium", key, this.settings.mode || "writing");
                return `
                <div class="wc-mascot-option ${this.settings.mascot === key ? 'wc-mascot-selected' : ''}" data-mascot="${key}">
                  <div class="wc-mascot-preview">${mascotData.svg}</div>
                  <span class="wc-mascot-option-name">${m.name}</span>
                </div>
              `}).join("")}
            </div>
          </div>

          <!-- 目标设置：独立开关 -->
          <div class="wc-settings-group">
            <label class="wc-settings-label">
              <span>目标设置</span>
              <span class="wc-settings-hint">开启后显示进度条，可随时开关</span>
            </label>
            <!-- 字数目标 -->
            <div class="wc-goal-settings-item ${this.settings.targetWordsEnabled ? '' : 'wc-goal-disabled'}" id="wc-set-words-item">
              <div class="wc-toggle-track ${this.settings.targetWordsEnabled ? 'wc-toggle-on' : ''}" id="wc-set-toggle-words">
                <div class="wc-toggle-thumb"></div>
              </div>
              <span class="wc-goal-settings-label">${ml.wordUnit}数</span>
              <div class="wc-goal-settings-input-wrap">
                <input type="number" class="wc-settings-input" id="wc-setting-target-words"
                       value="${this.settings.targetWords}" min="0" max="100000" step="100" ${this.settings.targetWordsEnabled ? '' : 'disabled'}/>
                <span class="wc-settings-unit">${ml.wordUnit}</span>
              </div>
            </div>
            <!-- 时长目标 -->
            <div class="wc-goal-settings-item ${this.settings.targetMinutesEnabled ? '' : 'wc-goal-disabled'}" id="wc-set-time-item">
              <div class="wc-toggle-track ${this.settings.targetMinutesEnabled ? 'wc-toggle-on' : ''}" id="wc-set-toggle-time">
                <div class="wc-toggle-thumb"></div>
              </div>
              <span class="wc-goal-settings-label">时 长</span>
              <div class="wc-goal-settings-input-wrap">
                <input type="number" class="wc-settings-input" id="wc-setting-target-minutes"
                       value="${this.settings.targetMinutes}" min="0" max="1440" step="10" ${this.settings.targetMinutesEnabled ? '' : 'disabled'}/>
                <span class="wc-settings-unit">分钟</span>
              </div>
            </div>
          </div>

          <!-- 快速预设 -->
          <div class="wc-settings-presets">
            <span class="wc-settings-presets-label">快速设定</span>
            <div class="wc-settings-presets-btns">
              <button class="wc-preset-btn" data-words="1000" data-minutes="60">1千/1时</button>
              <button class="wc-preset-btn" data-words="2000" data-minutes="90">2千/1.5时</button>
              <button class="wc-preset-btn ${this.settings.targetWords === 3000 ? 'wc-preset-active' : ''}" data-words="3000" data-minutes="120">3千/2时</button>
              <button class="wc-preset-btn" data-words="5000" data-minutes="180">5千/3时</button>
              <button class="wc-preset-btn" data-words="8000" data-minutes="240">8千/4时</button>
            </div>
          </div>
        </div>
        <div class="wc-settings-footer">
          <button class="wc-settings-cancel" id="wc-settings-cancel">取消</button>
          <button class="wc-settings-save" id="wc-settings-save">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.settingsEl);
    this.settingsVisible = true;

    const close = this.settingsEl.querySelector("#wc-settings-close");
    const cancel = this.settingsEl.querySelector("#wc-settings-cancel");
    const save = this.settingsEl.querySelector("#wc-settings-save");
    const overlay = this.settingsEl;

    const closeHandler = (e) => { e.stopPropagation(); this.hideSettings(); };
    close.addEventListener("click", closeHandler);
    cancel.addEventListener("click", closeHandler);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) this.hideSettings(); });

    // 模式切换（只选 .wc-mode-selector，避免误选其他按钮）
    const modeBtns = this.settingsEl.querySelectorAll(".wc-mode-selector");
    modeBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        modeBtns.forEach(b => b.classList.remove("wc-mode-active"));
        btn.classList.add("wc-mode-active");
        const mode = btn.dataset.mode;
        const ml2 = MODE_LABELS[mode];
        this.settingsEl.querySelectorAll(".wc-settings-unit").forEach((el, i) => {
          if (i === 0) el.textContent = ml2.wordUnit;
        });
      });
    });

    // 速率单位切换（只选 .wc-unit-btn）
    const unitMinBtn = this.settingsEl.querySelector("#wc-speed-unit-min");
    const unitHourBtn = this.settingsEl.querySelector("#wc-speed-unit-hour");
    const bindUnitBtn = (btn) => {
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.settings.speedUnit = btn.dataset.unit;
        if (unitMinBtn) unitMinBtn.classList.toggle("wc-mode-active", this.settings.speedUnit === "perMin");
        if (unitHourBtn) unitHourBtn.classList.toggle("wc-mode-active", this.settings.speedUnit === "perHour");
      });
    };
    bindUnitBtn(unitMinBtn);
    bindUnitBtn(unitHourBtn);

    // 面板主题选择
    const themeBtns = this.settingsEl.querySelectorAll(".wc-theme-btn");
    themeBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        themeBtns.forEach(b => b.classList.remove("wc-theme-active"));
        btn.classList.add("wc-theme-active");
        // 实时预览主题
        const theme = btn.dataset.theme;
        if (this.panelEl) {
          Object.keys(PANEL_THEMES).forEach(t => this.panelEl.classList.remove("wc-theme-" + t));
          this.panelEl.classList.add("wc-theme-" + theme);
        }
      });
    });

    // 角色选择
    const mascotOptions = this.settingsEl.querySelectorAll(".wc-mascot-option");
    mascotOptions.forEach(opt => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        mascotOptions.forEach(o => o.classList.remove("wc-mascot-selected"));
        opt.classList.add("wc-mascot-selected");
      });
    });

    // 设置面板内的目标开关
    const setWordsToggle = this.settingsEl.querySelector("#wc-set-toggle-words");
    const setTimeToggle = this.settingsEl.querySelector("#wc-set-toggle-time");
    const setWordsItem = this.settingsEl.querySelector("#wc-set-words-item");
    const setTimeItem = this.settingsEl.querySelector("#wc-set-time-item");
    const wordsInput = this.settingsEl.querySelector("#wc-setting-target-words");
    const minutesInput = this.settingsEl.querySelector("#wc-setting-target-minutes");

    const bindGoalToggle = (toggle, item, input, key) => {
      if (!toggle) return;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOn = toggle.classList.toggle("wc-toggle-on");
        item.classList.toggle("wc-goal-disabled", !isOn);
        if (input) input.disabled = !isOn;
        // 真正保存开关状态
        if (key === "targetWordsEnabled") {
          this.settings.targetWordsEnabled = isOn;
        } else if (key === "targetMinutesEnabled") {
          this.settings.targetMinutesEnabled = isOn;
        }
        this.saveSettings();
      });
    };
    bindGoalToggle(setWordsToggle, setWordsItem, wordsInput, "targetWordsEnabled");
    bindGoalToggle(setTimeToggle, setTimeItem, minutesInput, "targetMinutesEnabled");

    save.addEventListener("click", (e) => {
      e.stopPropagation();

      const activeMode = this.settingsEl.querySelector(".wc-mode-selector.wc-mode-active");
      if (activeMode) {
        const oldMode = this.settings.mode;
        this.settings.mode = activeMode.dataset.mode;
        if (oldMode !== this.settings.mode) {
          // 切换模式时重置字数基准
          this.lastWordCount = this.countByMode(getEditorText());
          this._windowTotalWords = 0;
          this._speedWindow = [];
          this.currentSpeed = 0;
        }
      }

      const selectedMascot = this.settingsEl.querySelector(".wc-mascot-option.wc-mascot-selected");
      if (selectedMascot) this.settings.mascot = selectedMascot.dataset.mascot;

      // 目标开关状态（从设置面板的开关读取）
      this.settings.targetWordsEnabled = setWordsToggle ? setWordsToggle.classList.contains("wc-toggle-on") : false;
      this.settings.targetMinutesEnabled = setTimeToggle ? setTimeToggle.classList.contains("wc-toggle-on") : false;

      if (wordsInput) this.settings.targetWords = Math.max(0, parseInt(wordsInput.value) || 0);
      if (minutesInput) this.settings.targetMinutes = Math.max(0, parseInt(minutesInput.value) || 0);

      // 速率单位
      const activeUnitBtn = this.settingsEl.querySelector("#wc-speed-unit-min.wc-mode-active, #wc-speed-unit-hour.wc-mode-active");
      if (activeUnitBtn) this.settings.speedUnit = activeUnitBtn.dataset.unit;

      // 面板主题
      const activeThemeBtn = this.settingsEl.querySelector(".wc-theme-btn.wc-theme-active");
      if (activeThemeBtn) this.settings.panelTheme = activeThemeBtn.dataset.theme;

      this.saveSettings();
      this.hideSettings();

      if (this.panelVisible && this.panelEl) {
        // 先清理旧的拖拽监听，防止 document 级事件累积
        if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
        this.panelEl.innerHTML = this.renderPanelHTML();
        // renderPanelHTML() 中的 HTML 内容已使用 CSS 变量，无需额外操作
        this.bindResetBtn();
        this.bindMinimizeBtn();
        this.bindSettingsBtn();
        this.bindDrag();
        this.bindMascotInteract();
        this.bindGoalToggles();
        this.panelEl.addEventListener("click", (e) => e.stopPropagation());
        this.startActivityCycle();
      }
      // 状态栏也应用主题
      applyPanelTheme(this.statusEl, this.settings.panelTheme);
      this.updateStatusBar();
      showToast("设置已保存");
    });

    // 快速预设
    const presets = this.settingsEl.querySelectorAll(".wc-preset-btn");
    presets.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const words = parseInt(btn.dataset.words);
        const minutes = parseInt(btn.dataset.minutes);
        if (wordsInput) wordsInput.value = words;
        if (minutesInput) minutesInput.value = minutes;
        presets.forEach(b => b.classList.remove("wc-preset-active"));
        btn.classList.add("wc-preset-active");
      });
    });
  }

  hideSettings() {
    if (this.settingsEl && this.settingsEl.parentNode) {
      this.settingsEl.parentNode.removeChild(this.settingsEl);
    }
    this.settingsEl = null;
    this.settingsVisible = false;
  }

  // ============ 拖拽 ============
  bindDrag() {
    if (!this.panelEl) return;
    const handle = this.panelEl.querySelector("#wc-drag-handle");
    if (!handle) return;

    const onDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".wc-minimize-btn") || e.target.closest(".wc-settings-btn")) return;
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
      this._clampPanel();
      // 记忆当前位置，最小化后恢复
      const r = this.panelEl.getBoundingClientRect();
      this._lastPanelPos = { left: r.left, top: r.top };
    };

    handle.addEventListener("mousedown", onDown);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    this._dragCleanup = () => {
      handle.removeEventListener("mousedown", onDown);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }

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

    mascot.classList.add("wc-mascot-bounce");
    mascot.classList.add("wc-mascot-interact");

    const pool = ENCOURAGEMENTS[this.settings.mode] || ENCOURAGEMENTS.writing;
    const msg = pool[Math.floor(Math.random() * pool.length)];
    bubble.textContent = msg;
    bubble.classList.remove("wc-bubble-show");
    void bubble.offsetWidth;
    bubble.classList.add("wc-bubble-show");

    if (this._interactTimer) clearTimeout(this._interactTimer);
    this._interactTimer = setTimeout(() => {
      if (!mascot || !bubble) return;
      mascot.classList.remove("wc-mascot-bounce");
      mascot.classList.remove("wc-mascot-interact");
      const mascInfo = getSpeedLevel(this._getCalibratedAvgSpeed());
      bubble.textContent = mascInfo.bubble;
    }, 2500);
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
    // 新结构：累积模式，全局共享
    this.dailyData[today] = { totalWords: 0, peakAvgSpeed: 0, writingTime: 0, idleTime: 0, startTime: null };
    this.dailyData.lastDate = today;
    // 重置运行时状态
    this.currentSpeed = 0;
    this.lastWordCount = this.countByMode(getEditorText());
    this._prevTotalWords = -1;
    this._wordsGoalReached = false;
    this._timeGoalReached = false;
    this._speedWindow = [];
    this._windowTotalWords = 0;
    this._instantWindow = [];
    this._instantTotalWords = 0;
    this.isIdle = false;
    await this.saveData();
    this.updateStatusBar();
    if (this.panelVisible) {
      this.hidePanel();
      this.showPanel();
    }
    siyuan.showMessage("今日数据已重置", 3000);
  }

  bindMinimizeBtn() {
    if (!this.panelEl) return;
    const btn = this.panelEl.querySelector("#wc-minimize-btn");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.hidePanel();
        showToast("已最小化 ← 点右下角状态栏重新打开");
      });
    }
  }

  // ============ 事件监听 ============
  bindEvents() {
    // 直接监听 ProseMirror 编辑器的 input 事件（最可靠）
    this._setupEditorInputListener();

    // 同时保留 eventBus 和 MutationObserver 作为备用
    const events = ["ws-main", "click-editorcontent"];
    for (const evt of events) this.eventBus.on(evt, this._boundHandleInput);

    this._observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" ||
            (mutation.type === "childList" && mutation.target.closest?.(".protyle-content"))) {
          this.handleInput();
          break;
        }
      }
    });
  }

  // 直接监听编辑器 input（v3.6.1 修复：不再等待2秒）
  _setupEditorInputListener() {
    const attach = () => {
      // 尝试多种可能的编辑器容器选择器
      const selectors = [
        ".protyle-content",
        ".protyle .protyle-content",
        "#editor .protyle-content",
        "[data-type='NodeParagraph']",
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && !el._wc_inputBound) {
          el._wc_inputBound = true;
          el.addEventListener("input", this._boundHandleInput, { passive: true });
          break;
        }
      }
    };
    attach();
    setTimeout(attach, 100);
    setTimeout(attach, 500);
    setTimeout(attach, 2000);

    // 监听文档切换，重新校准基准
    this._setupDocChangeListener();
  }

  // 监听文档切换，切换文档时重置字数基准，确保统计不串
  _setupDocChangeListener() {
    this._docChangeWSHandler = () => {
      setTimeout(() => {
        this._resyncWordCount();
      }, 400);
    };
    this._docChangeTabHandler = () => {
      setTimeout(() => {
        this._resyncWordCount();
      }, 600);
    };
    this.eventBus.on("ws-main", this._docChangeWSHandler);
    this.eventBus.on("click-tab", this._docChangeTabHandler);
  }

  // 重置字数基准：切换文档后，用当前文档的字数作为新基准
  _resyncWordCount() {
    const text = getEditorText();
    const count = this.countByMode(text);
    if (count !== this.lastWordCount) {
      this.lastWordCount = count;
      // 同时更新 prevTotalWords 避免跳变
      const todayData = this.getTodayData();
      if (this._prevTotalWords < 0) {
        this._prevTotalWords = todayData.totalWords;
      }
    }
  }

  unbindEvents() {
    const events = ["ws-main", "click-editorcontent"];
    for (const evt of events) this.eventBus.off(evt, this._boundHandleInput);
    // 清理文档切换监听（_setupDocChangeListener 注册的）
    if (this._docChangeWSHandler) this.eventBus.off("ws-main", this._docChangeWSHandler);
    if (this._docChangeTabHandler) this.eventBus.off("click-tab", this._docChangeTabHandler);
    document.removeEventListener("keydown", this._boundHandleInput);
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._dragCleanup) { this._dragCleanup(); this._dragCleanup = null; }
    document.querySelectorAll(".protyle-content").forEach(el => { el._wc_inputBound = false; });
  }

  // ============ 输入处理（滑动窗口驱动） ============
  // 规范：编辑器变更 → 仅 Δ > 0 才入窗口 → 立即重算 → RAF 节流刷新 UI
  handleInput() {
    const now = Date.now();
    const text = getEditorText();
    const currentCount = this.countByMode(text);
    const delta = currentCount - this.lastWordCount;

    // 仅有效增量（Δ > 0）才入窗口；删除/无变化不产生数据点
    if (delta > 0) {
      this._lastInputTime = now;
      if (this.isIdle) {
        this.isIdle = false;
        this._writingSessionStart = now;
      }

      // 累计今日总字数（全局累积）
      this.getTodayData().totalWords += delta;

      // 维护主速率滑动窗口（5 分钟）
      this._addToSlidingWindow(delta, now);

      // 维护瞬时爆发检测窗口（1 秒）
      this._instantWindow.push({ words: delta, time: now });
      this._instantTotalWords += delta;
      this._cleanInstantWindow(now);

      // 爆发检测：1 秒内连续输入超过 10 字 → 弹跳动效
      if (this._instantWindow.length > 0) {
        const recentSpan = (now - this._instantWindow[0].time) / 1000;
        if (recentSpan <= 1.0 && this._instantTotalWords >= 10 && now - this._lastBurstTime > 1000) {
          this._lastBurstTime = now;
          this._triggerBurst();
        }
      }

      // 重算速率（用于精灵状态）
      this._calcSpeedFromWindow(now);

      // RAF 节流刷新 UI
      this._scheduleUIUpdate();
    }

    this.lastWordCount = currentCount;
    this.lastSampleTime = now;
  }

  // ============ 采样定时器（200ms）============
  // 规范：专注维护窗口过期清理 + 时间统计，不更新速率显示
  startSampling() {
    const now = Date.now();
    this.lastSampleTime = now;
    this.lastInputTime = now;

    // 200ms 采样：窗口清理 + 时间统计
    this.sampleTimer = setInterval(() => this.collectData(), SAMPLE_INTERVAL);
  }

  stopSampling() {
    clearInterval(this.sampleTimer);
    this.sampleTimer = null;
  }

  /**
   * collectData（200ms 定时调用）
   * - 仅负责：窗口过期清理 + 发呆检测 + 时间统计 + 峰值记录
   * - 速率在发呆时持续 EMA 衰减（不瞬间清零）
   */
  collectData() {
    const now = Date.now();
    const deltaMs = now - this.lastSampleTime;
    const deltaSec = deltaMs / 1000;
    if (deltaMs <= 0) return;
    this.lastSampleTime = now;

    // 发呆检测（超过 5 分钟无输入）
    if (now - this._lastInputTime > IDLE_TIMEOUT) {
      if (!this.isIdle) {
        this.isIdle = true;
        // 结算上一个会话的写作时间
        if (this._writingSessionStart > 0) {
          const todayData = this.getTodayData();
          const duration = Math.max(0, (this._lastInputTime - this._writingSessionStart) / 1000);
          if (duration > 0) todayData.writingTime += duration;
        }
        // 清空滑动窗口（不再清 currentSpeed，让 EMA 自然衰减）
        this._windowTotalWords = 0;
        this._speedWindow = [];
        this._instantTotalWords = 0;
        this._instantWindow = [];
      }
      // 发呆时长计入今日
      this.getTodayData().idleTime += deltaSec;
    } else {
      if (this.isIdle) {
        this.isIdle = false;
        this._writingSessionStart = now;
      }
      // 写作时长计入今日
      this.getTodayData().writingTime += deltaSec;

      // 清理主窗口过期数据
      this._cleanExpiredWindow(now);

      // EMA 衰减：窗口数据不足时主速率自然归零
      if (this._speedWindow.length < 2) {
        this.currentSpeed = this._emaSmooth(this._prevDisplayedSpeed, 0, EMA_MAIN);
        this._prevDisplayedSpeed = this.currentSpeed;
      }
    }

    // 峰值记录：追踪平均速率的峰值（总字数/写作时长 的历史最大值）
    const todayData = this.getTodayData();
    if (todayData.writingTime > 30) {
      const avgSpeed = this._getCalibratedAvgSpeed();
      if (avgSpeed > (todayData.peakAvgSpeed || 0)) {
        todayData.peakAvgSpeed = avgSpeed;
      }
    }

    if (Math.random() < 0.05) this.saveData();
  }

  // ============ 滑动窗口核心 ============

  /**
   * 向滑动窗口添加一个有效数据点
   * @param {number} words - 本次增量（> 0）
   * @param {number} now - 当前时间戳
   */
  _addToSlidingWindow(words, now) {
    this._speedWindow.push({ words, time: now });
    this._windowTotalWords += words;

    // 清理超出 W 的旧数据
    this._cleanExpiredWindow(now);
  }

  /**
   * 清理超出滑动窗口 W 的过期数据
   * 规范：O(N)，N 为窗口内数据点个数（通常很小）
   */
  _cleanExpiredWindow(now) {
    const cutoff = now - SPEED_WINDOW;
    while (
      this._speedWindow.length > 0 &&
      this._speedWindow[0].time < cutoff
    ) {
      this._windowTotalWords -= this._speedWindow[0].words;
      this._speedWindow.shift();
    }
  }

  /**
   * 根据滑动窗口计算实时速率
   * 规范：CPH = (SumWords / T) × 3600
   * EMA 平滑：增长快（α=0.2）·衰减慢
   */
  _calcSpeedFromWindow(now) {
    let rawMainSpeed = 0;
    if (this._speedWindow.length >= 2) {
      const T = (now - this._speedWindow[0].time) / 1000;
      if (T > 0) {
        rawMainSpeed = (this._windowTotalWords / T) * 3600;
        // EMA 平滑：增长快·衰减慢
        this.currentSpeed = this._emaSmooth(this._prevDisplayedSpeed, rawMainSpeed, EMA_MAIN);
        this._prevDisplayedSpeed = this.currentSpeed;
      }
    } else {
      // 窗口数据不足 → EMA 衰减归零
      this.currentSpeed = this._emaSmooth(this._prevDisplayedSpeed, 0, EMA_MAIN);
      this._prevDisplayedSpeed = this.currentSpeed;
    }

    // 精灵状态滞回（稳定后才切换）
    this._updateMascotHysteresis(now);
  }

  /**
   * 指数移动平均（EMA）
   * 规范：displayed = old × (1 - α) + new × α
   * @param {number} oldValue  上次显示值
   * @param {number} newValue  原始计算值
   * @param {number} alpha     平滑系数（0~1，越大越灵敏）
   */
  _emaSmooth(oldValue, newValue, alpha) {
    return oldValue * (1 - alpha) + newValue * alpha;
  }

  /**
   * 爆发弹跳动画（v3.9：去掉实时速率后应用于今日字数）
   * 触发条件：1 秒内连续输入超过 10 字
   * 效果：今日字数数字短暂放大变金
   */
  _triggerBurst() {
    const wordsNumEl = this.panelEl ? this.panelEl.querySelector("#wc-hero-words-num") : null;
    if (!wordsNumEl) return;
    // 移除旧动画，防止叠加
    wordsNumEl.classList.remove("wc-burst");
    void wordsNumEl.offsetWidth;
    wordsNumEl.classList.add("wc-burst");
  }

  /**
   * 清理瞬时爆发窗口（1 秒过期）
   */
  _cleanInstantWindow(now) {
    const cutoff = now - 1000; // 1 秒
    while (
      this._instantWindow.length > 0 &&
      this._instantWindow[0].time < cutoff
    ) {
      this._instantTotalWords -= this._instantWindow[0].words;
      this._instantWindow.shift();
    }
  }

  // ============ RAF 节流 UI 刷新 ============
  // 规范：采用 requestAnimationFrame 节流，避免阻塞 UI 线程

  _scheduleUIUpdate() {
    if (this._uiUpdateScheduled) return;
    this._uiUpdateScheduled = true;
    requestAnimationFrame(() => {
      this._uiUpdateScheduled = false;
      this.updateStatusBar();
      this.updateMascotState();
    });
  }

  /**
   * 独立更新精灵状态（基于滞回后的 _lastMascotState）
   * 由 refreshSpeedDisplay() 驱动（5s/10s 节奏）
   */
  updateMascotState() {
    if (!this.panelEl) return;
    const mascot = this.panelEl.querySelector("#wc-mascot");
    if (!mascot || mascot.classList.contains("wc-mascot-interact")) return;
    if (mascot.dataset.state === this._lastMascotState) return;

    mascot.dataset.state = this._lastMascotState;
    const svgEl = mascot.querySelector("svg");
    if (svgEl) {
      const mascData = renderMascotSVG(this._lastMascotState, this.settings.mascot || "cat", this.settings.mode || "writing");
      svgEl.outerHTML = mascData.svg;
      const heroMascot = this.panelEl.querySelector(".wc-hero-mascot");
      if (heroMascot) {
        heroMascot.style.setProperty("--mascot-bubble-bg", mascData.bubbleBg);
        heroMascot.style.setProperty("--mascot-bubble-arrow", mascData.bubbleArrow);
      }
    }
    const bubble = this.panelEl.querySelector("#wc-mascot-bubble");
    if (bubble) {
      const mascInfo = getSpeedLevel(this._getCalibratedAvgSpeed());
      bubble.textContent = mascInfo.bubble;
    }
  }

  // 精灵状态等级映射（滞回用）
  _lastMascotLevel() {
    const map = { idle: 0, slow: 1, medium: 2, fast: 3, blazing: 4 };
    return map[this._lastMascotState] ?? 0;
  }

  // 精灵状态滞回（基于平均速率）
  _updateMascotHysteresis(now) {
    const avgSpeed = this._getCalibratedAvgSpeed();
    const info = getSpeedLevel(avgSpeed);
    if (info.state === this._lastMascotState) {
      this._mascotStateSince = now;
    } else {
      const elapsed = now - this._mascotStateSince;
      const isDowngrade = info.level < this._lastMascotLevel();
      const hysteresis = isDowngrade ? MASCOT_HYSTERESIS_MS * 1.5 : MASCOT_HYSTERESIS_MS;
      if (elapsed >= hysteresis) {
        this._lastMascotState = info.state;
        this._mascotStateSince = now;
      }
    }
  }

  _getCalibratedAvgSpeed() {
    const todayData = this.getTodayData();
    const writingMinutes = todayData.writingTime / 60;
    if (writingMinutes < 0.5) return 0;
    return Math.round(todayData.totalWords / writingMinutes);
  }

  /**
   * 获取原始平均速率（总字数 / 写作时长分钟数）
   * 这是用户看到的"平均速率"——专注打字期间的平均输出能力
   */
  _getRawAvgSpeed() {
    return this._getCalibratedAvgSpeed();
  }
}

module.exports = WordCounterPlugin;
