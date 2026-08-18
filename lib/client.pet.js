/*
 * dsh-pixel-pet — DSH browser/client half.
 *
 * A floating pixel big-head desktop pet for the DeepSeek Harness web
 * surface. Two live alignments:
 *
 *   1. Character tier (GIF number 01-06) follows the performance level of
 *      the dsh-performance-slider plugin (0-5 → gif 01-06). The level is
 *      shared through the same localStorage key / cookie the slider writes,
 *      and the pet also watches `body[data-dsh-performance-level]` so it
 *      tracks the slider live, even mid-drag.
 *
 *   2. Animation state (idle/rest/work/done/wait) follows the current
 *      conversation execution state from the session snapshot:
 *        - running && no pending interactions → work (工作)
 *        - running (or paused) with pending interactions → wait (等待)
 *        - finished a turn (running flipped true→false) → done (完成), briefly
 *        - blank session / no session → rest (休息)
 *        - otherwise → idle (待机)
 *
 * GIFs are served by the host half from
 * `/plugins/dsh-pixel-pet/gifs/{01-06}_{idle,rest,work,done,wait}.gif`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pixel-pet',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const jsxRuntime = require('react/jsx-runtime');
    const jsx = jsxRuntime.jsx;
    const jsxs = jsxRuntime.jsxs;

    const PLUGIN_ID = 'dsh-pixel-pet';
    const NS = 'dshpixelpet.pet';
    const GIF_URL_PREFIX = '/plugins/dsh-pixel-pet/gifs';
    const STATES = ['idle', 'rest', 'work', 'done', 'wait'];

    /* Level is shared with dsh-performance-slider (same keys). The slider
     * writes `body[data-dsh-performance-level]` on every apply, so the pet
     * watches that attribute live (MutationObserver needs the real attribute
     * name; dataset reads use the camelCase key). */
    const LEVEL_STORAGE_KEY = 'dsh-performance-slider.level.v1';
    const LEVEL_COOKIE_KEY = 'dshps_level';
    const LEVEL_ATTR = 'data-dsh-performance-level';
    const LEVEL_DATASET_KEY = 'dshPerformanceLevel';

    const DONE_HOLD_MS = 3600;
    const BUBBLE_HOLD_MS = 2600;

    /* ------------------------------------------------------------------ */
    /* Tier metadata (mirrors the performance-slider 6 levels)             */
    /* ------------------------------------------------------------------ */

    const TIERS = [
      { name: '瘦白领', nameEn: 'Office Slim', color: '#4d7cfe', modelShort: 'Flash', effort: 'off' },
      { name: '清秀西装', nameEn: 'Clean Suit', color: '#23c9b0', modelShort: 'Flash', effort: 'low' },
      { name: '型男西装', nameEn: 'Handsome Suit', color: '#9673f6', modelShort: 'Flash', effort: 'max' },
      { name: '中山装', nameEn: 'Mandarin', color: '#2ec98b', modelShort: 'Pro', effort: 'off' },
      { name: '怒目武者', nameEn: 'Warrior', color: '#f5a524', modelShort: 'Pro', effort: 'high' },
      { name: '冕冠帝王', nameEn: 'Emperor', color: '#f7597c', modelShort: 'Pro', effort: 'max' },
    ];

    /* ------------------------------------------------------------------ */
    /* Helpers                                                              */
    /* ------------------------------------------------------------------ */

    function clampLevel(value) {
      return Math.max(0, Math.min(TIERS.length - 1, Number(value) || 0));
    }

    function readCookie(name) {
      if (typeof document === 'undefined' || !document.cookie) return null;
      const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : null;
    }

    function readStoredLevel() {
      try {
        const stored = window.localStorage.getItem(LEVEL_STORAGE_KEY);
        if (stored !== null) return clampLevel(stored);
      } catch { /* storage is best-effort only */ }
      const cookie = readCookie(LEVEL_COOKIE_KEY);
      if (cookie !== null) return clampLevel(cookie);
      const attr = typeof document !== 'undefined' && document.body
        ? document.body.dataset[LEVEL_DATASET_KEY]
        : undefined;
      if (attr !== undefined) return clampLevel(attr);
      return 0;
    }

    function gifUrl(levelIndex, state) {
      const tier = String(levelIndex + 1).padStart(2, '0');
      const name = STATES.includes(state) ? state : 'idle';
      return `${GIF_URL_PREFIX}/${tier}_${name}.gif`;
    }

    /* ------------------------------------------------------------------ */
    /* Drag position (persisted across reloads)                            */
    /* ------------------------------------------------------------------ */

    const POSITION_KEY = 'dsh-pixel-pet.position.v1';
    const POSITION_EDGE = 8;

    function readStoredPosition() {
      try {
        const raw = window.localStorage.getItem(POSITION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            return { x: parsed.x, y: parsed.y };
          }
        }
      } catch { /* storage is best-effort only */ }
      return null;
    }

    function persistPosition(x, y) {
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
      } catch { /* storage is best-effort only */ }
    }

    /** Clamp a pet top-left position inside the viewport (uses the current element size). */
    function clampPosition(rect, x, y) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const maxX = Math.max(POSITION_EDGE, w - rect.width - POSITION_EDGE);
      const maxY = Math.max(POSITION_EDGE, h - rect.height - POSITION_EDGE);
      return {
        x: Math.max(POSITION_EDGE, Math.min(maxX, x)),
        y: Math.max(POSITION_EDGE, Math.min(maxY, y)),
      };
    }

    /* ------------------------------------------------------------------ */
    /* Styles                                                               */
    /* ------------------------------------------------------------------ */

    function buildStylesheet() {
      return `
.dshpet {
  position: fixed;
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  font-family: var(--dsw-font-family, ui-sans-serif, system-ui, sans-serif);
}
.dshpet[data-dragging="true"] { cursor: grabbing !important; }
.dshpet_stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: grab;
}
.dshpet_card {
  position: relative;
  width: 128px;
  height: 128px;
  border-radius: 22px;
  background: var(--dsw-specific-tip, rgba(20, 26, 38, 0.55));
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.30);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  overflow: visible;
  transition: transform 140ms var(--ds-ease-out, ease-out), border-color 200ms ease;
}
.dshpet_card:hover { transform: translateY(-2px) scale(1.02); }
.dshpet_card[data-level-bump="true"] { animation: dshpet_pop 320ms var(--ds-ease-out, ease-out); }
@keyframes dshpet_pop {
  0% { transform: scale(0.86); }
  55% { transform: scale(1.06); }
  100% { transform: scale(1); }
}
.dshpet_gif {
  width: 118px;
  height: 118px;
  object-fit: contain;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  animation: dshpet_bob 3.2s ease-in-out infinite;
}
.dshpet[data-state="rest"] .dshpet_gif,
.dshpet[data-state="done"] .dshpet_gif,
.dshpet[data-state="work"] .dshpet_gif {
  animation: none;
}
@keyframes dshpet_bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
.dshpet_badge {
  position: absolute;
  top: -8px;
  left: -8px;
  min-width: 34px;
  height: 22px;
  padding: 0 7px;
  box-sizing: border-box;
  border-radius: 999px;
  background: #101418;
  border: 2px solid var(--dshpet-accent, #4d7cfe);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  letter-spacing: 0.04em;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
}
.dshpet_dot {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #101418;
  background: var(--dshpet-state-color, #8b93a7);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
}
.dshpet_dot[data-active="true"] { animation: dshpet_pulse 1.6s ease-in-out infinite; }
@keyframes dshpet_pulse {
  0%, 100% { box-shadow: 0 2px 6px rgba(0,0,0,.35), 0 0 0 0 var(--dshpet-state-color); }
  50% { box-shadow: 0 2px 6px rgba(0,0,0,.35), 0 0 0 6px transparent; }
}
.dshpet_shadow {
  width: 76px;
  height: 14px;
  margin-top: -4px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.38) 0%, transparent 70%);
  animation: dshpet_shadow 3.2s ease-in-out infinite;
}
.dshpet[data-state="rest"] .dshpet_shadow,
.dshpet[data-state="done"] .dshpet_shadow,
.dshpet[data-state="work"] .dshpet_shadow { animation: none; }
@keyframes dshpet_shadow {
  0%, 100% { transform: scaleX(1); opacity: 1; }
  50% { transform: scaleX(0.82); opacity: 0.65; }
}
.dshpet_chip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--dsw-specific-tip, rgba(16, 20, 24, 0.82));
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  color: var(--dsw-alias-label-primary, #e8ecf4);
  font-size: 12px;
  font-weight: 600;
  line-height: 24px;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.dshpet_chip_ind {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dshpet-state-color, #8b93a7);
}
.dshpet_bubble {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  max-width: 160px;
  padding: 7px 11px;
  border-radius: 12px;
  background: var(--dsw-specific-tip, rgba(16, 20, 24, 0.92));
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  color: var(--dsw-alias-label-primary, #e8ecf4);
  font-size: 12px;
  font-weight: 600;
  line-height: 17px;
  text-align: center;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
  pointer-events: none;
  animation: dshpet_bubble_in 180ms var(--ds-ease-out, ease-out);
}
.dshpet_bubble::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -6px;
  border: 6px solid transparent;
  border-top-color: var(--dsw-specific-tip, rgba(16, 20, 24, 0.92));
}
@keyframes dshpet_bubble_in {
  from { opacity: 0; transform: translateX(-50%) translateY(6px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.dshpet_popover {
  position: absolute;
  bottom: calc(100% + 14px);
  right: 0;
  width: 216px;
  padding: 12px 14px;
  box-sizing: border-box;
  border-radius: 14px;
  background: var(--dsw-specific-tip, rgba(16, 20, 24, 0.94));
  border: 1px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.14));
  color: var(--dsw-alias-label-primary, #e8ecf4);
  font-size: 12px;
  line-height: 19px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.40);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: dshpet_bubble_in 160ms var(--ds-ease-out, ease-out);
  z-index: 2147483001;
}
.dshpet_popover_title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
}
.dshpet_popover_row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.dshpet_popover_k {
  color: var(--dsw-alias-label-tertiary, #8b93a7);
  flex: none;
}
.dshpet_popover_v {
  min-width: 0;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshpet_popover_err {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-state-error-fill, rgba(225, 29, 72, 0.14));
  border: 1px solid var(--dsw-alias-state-error-primary, rgba(247, 89, 124, 0.6));
  color: var(--dsw-alias-state-error-primary, #f7597c);
  font-size: 11px;
  line-height: 16px;
  max-height: 64px;
  overflow: hidden;
}
.dshpet_card[data-error="true"] { border-color: var(--dsw-alias-state-error-primary, #f7597c); }
@media (prefers-reduced-motion: reduce) {
  .dshpet_gif, .dshpet_shadow { animation: none !important; }
  .dshpet_card[data-level-bump="true"] { animation: none !important; }
}
`;
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = `${PLUGIN_ID}/pet.css`;
      tag.textContent = buildStylesheet();
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    /* ------------------------------------------------------------------ */
    /* Locale                                                               */
    /* ------------------------------------------------------------------ */

    const zh = {
      'pet.state.idle': '待机',
      'pet.state.rest': '休息',
      'pet.state.work': '工作',
      'pet.state.done': '完成',
      'pet.state.wait': '等待',
      'pet.bubble.work': '干活中…',
      'pet.bubble.wait': '等你呢…',
      'pet.bubble.done': '搞定！',
      'pet.bubble.rest': '歇会儿',
      'pet.bubble.idle': '待命中',
      'pet.bubble.level': '切换角色：{name}',
      'pet.popover.title': '像素宠物',
      'pet.popover.level': '性能等级',
      'pet.popover.tier': '角色',
      'pet.popover.preset': '档位',
      'pet.popover.state': '动作状态',
      'pet.popover.session': '会话',
      'pet.popover.session.none': '无',
      'pet.popover.running': '执行中',
      'pet.popover.running.yes': '是',
      'pet.popover.running.no': '否',
      'pet.popover.pending': '等待交互',
      'pet.popover.error': '最近错误',
      'pet.popover.error.none': '无',
      'pet.lv': 'Lv.{n}',
    };

    const en = {
      'pet.state.idle': 'Idle',
      'pet.state.rest': 'Resting',
      'pet.state.work': 'Working',
      'pet.state.done': 'Done',
      'pet.state.wait': 'Waiting',
      'pet.bubble.work': 'Working…',
      'pet.bubble.wait': 'Waiting for you…',
      'pet.bubble.done': 'Done!',
      'pet.bubble.rest': 'Resting',
      'pet.bubble.idle': 'On standby',
      'pet.bubble.level': 'Switched: {name}',
      'pet.popover.title': 'Pixel Pet',
      'pet.popover.level': 'Performance',
      'pet.popover.tier': 'Character',
      'pet.popover.preset': 'Preset',
      'pet.popover.state': 'Action state',
      'pet.popover.session': 'Session',
      'pet.popover.session.none': 'none',
      'pet.popover.running': 'Running',
      'pet.popover.running.yes': 'yes',
      'pet.popover.running.no': 'no',
      'pet.popover.pending': 'Pending input',
      'pet.popover.error': 'Last error',
      'pet.popover.error.none': 'none',
      'pet.lv': 'Lv.{n}',
    };

    /* ------------------------------------------------------------------ */
    /* Hooks                                                                */
    /* ------------------------------------------------------------------ */

    function useCurrentSession(sessions) {
      return React.useSyncExternalStore(
        React.useCallback(
          (fn) => sessions.currentProvideInfo.subscribe(fn),
          [sessions]
        ),
        React.useCallback(
          () => sessions.currentProvideInfo.getSnapshot(),
          [sessions]
        )
      );
    }

    function useSessionSnapshot(sessions, info) {
      const session = React.useMemo(() => {
        if (!info || info.sessionId === undefined || info.sessionId === null) return undefined;
        const binding = sessions.binding(info.sessionId);
        return binding ? binding.session : undefined;
      }, [sessions, info]);

      const subscribe = React.useCallback(
        (fn) => (session ? session.subscribe(fn) : () => {}),
        [session]
      );
      const getSnapshot = React.useCallback(
        () => (session ? session.getSnapshot() : null),
        [session]
      );
      return React.useSyncExternalStore(subscribe, getSnapshot);
    }

    function usePerformanceLevel() {
      const [level, setLevel] = React.useState(readStoredLevel);

      /* Observer path: this tab's slider wrote the body attribute — it is the
       * freshest signal (covers mid-drag changes). Storage path: a change in
       * ANOTHER tab — that tab's slider never touched this tab's body, so the
       * stale local attribute must NOT win; localStorage is authoritative. */
      const syncFromAttr = React.useCallback(() => {
        const attr = document.body ? document.body.dataset[LEVEL_DATASET_KEY] : undefined;
        if (attr !== undefined && attr !== '') setLevel(clampLevel(attr));
      }, []);

      const syncFromStorage = React.useCallback(() => {
        try {
          const stored = window.localStorage.getItem(LEVEL_STORAGE_KEY);
          if (stored !== null) setLevel(clampLevel(stored));
        } catch { /* storage is best-effort only */ }
      }, []);

      React.useEffect(() => {
        const observer = new MutationObserver(syncFromAttr);
        const target = document.body || document.documentElement;
        if (target) {
          observer.observe(target, {
            attributes: true,
            attributeFilter: [LEVEL_ATTR],
          });
        }
        window.addEventListener('storage', syncFromStorage);
        return () => {
          observer.disconnect();
          window.removeEventListener('storage', syncFromStorage);
        };
      }, [syncFromAttr, syncFromStorage]);

      return level;
    }

    /* ------------------------------------------------------------------ */
    /* Pet widget                                                           */
    /* ------------------------------------------------------------------ */

    function PetWidget({ sessions, t }) {
      const info = useCurrentSession(sessions);
      const snapshot = useSessionSnapshot(sessions, info);
      const level = usePerformanceLevel();

      const [state, setState] = React.useState('rest');
      const [bubble, setBubble] = React.useState(null);
      const [showInfo, setShowInfo] = React.useState(false);
      const [bumpKey, setBumpKey] = React.useState(0);
      const [dragging, setDragging] = React.useState(false);
      const [pos, setPos] = React.useState(null);
      const rootRef = React.useRef(null);
      const dragRef = React.useRef(null);
      const suppressClickRef = React.useRef(false);
      const prevRef = React.useRef(null);
      const sessionRef = React.useRef(null);
      const levelRef = React.useRef(level);

      /* Position: default bottom-right on first mount, then clamped + persisted. */
      React.useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const stored = readStoredPosition();
        setPos(clampPosition(
          rect,
          stored ? stored.x : window.innerWidth - rect.width - 22,
          stored ? stored.y : window.innerHeight - rect.height - 26
        ));
        const onResize = () => {
          setPos((current) => (current ? clampPosition(rect, current.x, current.y) : current));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);

      /* Apply position to the fixed root. */
      React.useEffect(() => {
        const el = rootRef.current;
        if (el && pos) {
          el.style.left = `${pos.x}px`;
          el.style.top = `${pos.y}px`;
        }
      }, [pos]);

      const onPointerDown = React.useCallback((event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const el = rootRef.current;
        if (!el) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          origLeft: el.offsetLeft,
          origTop: el.offsetTop,
          moved: false,
        };
        if (el.setPointerCapture) {
          try { el.setPointerCapture(event.pointerId); } catch { /* already released */ }
        }
        setDragging(true);
      }, []);

      const onPointerMove = React.useCallback((event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          const el = rootRef.current;
          if (el) {
            el.style.left = `${drag.origLeft + dx}px`;
            el.style.top = `${drag.origTop + dy}px`;
          }
        }
      }, []);

      const endDrag = React.useCallback(() => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setDragging(false);
        if (drag.moved) {
          suppressClickRef.current = true;
          const el = rootRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            const clamped = clampPosition(rect, rect.left, rect.top);
            setPos(clamped);
            persistPosition(clamped.x, clamped.y);
          }
          window.setTimeout(() => { suppressClickRef.current = false; }, 0);
        }
      }, []);

      /* Level change: the GIF follows live (drag boundaries included), but the
       * pop + "switched character" bubble fire only once the level stabilizes
       * (debounced) so mid-drag boundary crossings don't stutter. */
      const levelTimerRef = React.useRef(null);
      React.useEffect(() => {
        if (levelRef.current === level) return;
        levelRef.current = level;
        if (levelTimerRef.current) window.clearTimeout(levelTimerRef.current);
        levelTimerRef.current = window.setTimeout(() => {
          levelTimerRef.current = null;
          setBumpKey((k) => k + 1);
          setBubble(t('pet.bubble.level', { name: TIERS[levelRef.current].name }));
        }, 350);
        return () => {
          if (levelTimerRef.current) {
            window.clearTimeout(levelTimerRef.current);
            levelTimerRef.current = null;
          }
        };
      }, [level, t]);

      /* Conversation-state machine (pure derivation; side effects live in the
       * state-reaction effect below so StrictMode double-invokes stay clean). */
      React.useEffect(() => {
        const currentSession = info && info.sessionId !== undefined && info.sessionId !== null
          ? info.sessionId
          : null;
        if (currentSession !== sessionRef.current) {
          sessionRef.current = currentSession;
          prevRef.current = null;
        }

        if (!snapshot) {
          setState('rest');
          return;
        }
        const prev = prevRef.current;
        prevRef.current = snapshot;

        const { running, pending, blank } = snapshot;
        const waiting = Array.isArray(pending) && pending.length > 0;
        let next;
        if (running) next = waiting ? 'wait' : 'work';
        else if (waiting) next = 'wait';
        else if (blank) next = 'rest';
        else if (prev && prev.running) next = 'done';
        else next = 'idle';

        setState((current) => (current === next ? current : next));
      }, [snapshot, info]);

      /* React to state changes: bubbles, and the done → idle hold. */
      React.useEffect(() => {
        if (state === 'done') {
          setBubble(t('pet.bubble.done'));
          const timer = window.setTimeout(() => {
            setState((latest) => (latest === 'done' ? 'idle' : latest));
          }, DONE_HOLD_MS);
          return () => window.clearTimeout(timer);
        }
        if (state === 'work') setBubble(t('pet.bubble.work'));
        else if (state === 'wait') setBubble(t('pet.bubble.wait'));
      }, [state, t]);

      /* Bubble auto-hide. */
      React.useEffect(() => {
        if (bubble === null) return;
        const timer = window.setTimeout(() => setBubble(null), BUBBLE_HOLD_MS);
        return () => window.clearTimeout(timer);
      }, [bubble]);

      const tier = TIERS[level];
      const gif = gifUrl(level, state);
      const stateLabel = t(`pet.state.${state}`);
      const errorText = snapshot && snapshot.lastAgentError ? snapshot.lastAgentError : null;
      const sessionId = info && info.sessionId !== undefined ? String(info.sessionId) : null;
      const running = Boolean(snapshot && snapshot.running);
      const pendingCount = snapshot && Array.isArray(snapshot.pending) ? snapshot.pending.length : 0;
      const presetLabel = `${tier.modelShort} · ${tier.effort}`;

      return jsxs('div', {
        ref: rootRef,
        className: 'dshpet',
        'data-state': state,
        'data-level': String(level + 1),
        'data-dragging': dragging ? 'true' : undefined,
        'data-dsh-pixel-pet': '',
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onLostPointerCapture: endDrag,
        children: [
          showInfo
            ? jsxs('div', {
                className: 'dshpet_popover',
                role: 'dialog',
                children: [
                  jsxs('div', {
                    className: 'dshpet_popover_title',
                    children: [
                      jsx('span', { children: t('pet.popover.title') }),
                      jsx('span', {
                        style: { color: tier.color },
                        children: t('pet.lv', { n: String(level + 1) }),
                      }),
                    ],
                  }),
                  jsx('div', {
                    className: 'dshpet_popover_row',
                    children: [
                      jsx('span', { className: 'dshpet_popover_k', children: t('pet.popover.tier') }),
                      jsx('span', { className: 'dshpet_popover_v', children: tier.name }),
                    ],
                  }),
                  jsx('div', {
                    className: 'dshpet_popover_row',
                    children: [
                      jsx('span', { className: 'dshpet_popover_k', children: t('pet.popover.preset') }),
                      jsx('span', { className: 'dshpet_popover_v', children: presetLabel }),
                    ],
                  }),
                  jsx('div', {
                    className: 'dshpet_popover_row',
                    children: [
                      jsx('span', { className: 'dshpet_popover_k', children: t('pet.popover.state') }),
                      jsx('span', {
                        className: 'dshpet_popover_v',
                        style: { color: 'var(--dshpet-state-color)' },
                        children: stateLabel,
                      }),
                    ],
                  }),
                  jsx('div', {
                    className: 'dshpet_popover_row',
                    children: [
                      jsx('span', { className: 'dshpet_popover_k', children: t('pet.popover.session') }),
                      jsx('span', {
                        className: 'dshpet_popover_v',
                        title: sessionId || undefined,
                        children: sessionId
                          ? `${sessionId.slice(0, 8)}${sessionId.length > 8 ? '…' : ''}`
                          : t('pet.popover.session.none'),
                      }),
                    ],
                  }),
                  jsx('div', {
                    className: 'dshpet_popover_row',
                    children: [
                      jsx('span', { className: 'dshpet_popover_k', children: t('pet.popover.running') }),
                      jsx('span', {
                        className: 'dshpet_popover_v',
                        children: running ? t('pet.popover.running.yes') : t('pet.popover.running.no'),
                      }),
                    ],
                  }),
                  jsx('div', {
                    className: 'dshpet_popover_row',
                    children: [
                      jsx('span', { className: 'dshpet_popover_k', children: t('pet.popover.pending') }),
                      jsx('span', { className: 'dshpet_popover_v', children: String(pendingCount) }),
                    ],
                  }),
                  errorText
                    ? jsx('div', {
                        className: 'dshpet_popover_err',
                        title: errorText,
                        children: jsxs('div', {
                          children: [
                            jsx('div', { style: { fontWeight: 700, marginBottom: 2 }, children: t('pet.popover.error') }),
                            jsx('div', { children: errorText }),
                          ],
                        }),
                      })
                    : null,
                ],
              })
            : null,
          jsxs('div', {
            className: 'dshpet_stage',
            role: 'button',
            tabIndex: 0,
            'aria-label': `${tier.name} · ${stateLabel}`,
            onClick: () => {
              if (suppressClickRef.current) return;
              setShowInfo((v) => !v);
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setShowInfo((v) => !v);
              }
            },
            children: [
              bubble
                ? jsx('div', {
                    className: 'dshpet_bubble',
                    'aria-hidden': 'true',
                    children: bubble,
                  })
                : null,
              jsx('div', {
                key: bumpKey > 0 ? `card-${bumpKey}` : 'card-0',
                className: 'dshpet_card',
                'data-error': errorText ? 'true' : undefined,
                'data-level-bump': 'true',
                style: { '--dshpet-accent': tier.color },
                children: [
                  jsx('img', {
                    key: gif,
                    className: 'dshpet_gif',
                    src: gif,
                    alt: `${tier.name} · ${stateLabel}`,
                    draggable: false,
                  }),
                  jsx('span', {
                    className: 'dshpet_badge',
                    style: { '--dshpet-accent': tier.color },
                    children: t('pet.lv', { n: String(level + 1) }),
                  }),
                  jsx('span', {
                    className: 'dshpet_dot',
                    'data-active': state === 'work' || state === 'wait' ? 'true' : undefined,
                    style: { '--dshpet-state-color': stateColor(state) },
                  }),
                ],
              }),
              jsx('div', { className: 'dshpet_shadow' }),
            ],
          }),
          jsxs('div', {
            className: 'dshpet_chip',
            style: { '--dshpet-state-color': stateColor(state) },
            children: [
              jsx('span', { className: 'dshpet_chip_ind' }),
              jsx('span', { children: stateLabel }),
            ],
          }),
        ],
      });
    }

    function stateColor(state) {
      switch (state) {
        case 'work': return '#4ade80';
        case 'wait': return '#f5a524';
        case 'done': return '#4d7cfe';
        case 'rest': return '#8b93a7';
        default: return '#23c9b0';
      }
    }

    /* ------------------------------------------------------------------ */
    /* Plugin body                                                          */
    /* ------------------------------------------------------------------ */

    const inject = ['sessions', 'slots', 'locale'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-pixel-pet: dictionaries');

      ctx.effect(() => {
        const removeStyles = installStyles();
        return removeStyles;
      }, 'dsh-pixel-pet: styles');

      const PetEntry = (props) => jsx(PetWidget, { sessions: ctx.sessions, ...props });

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'pixel-pet',
        order: 100,
        locale: NS,
      }, PetEntry));
    }

    exports.TIERS = TIERS;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
