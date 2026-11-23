// Runs inside the page's own JavaScript context (world: MAIN), before the page's scripts.
//
// It only watches what the page does: writes to the clipboard, full screen requests,
// keyboard lock, dialog loops and Back-button traps. It makes no decisions itself:
// every clipboard text is handed to the extension's isolated script, which scores it in a
// context the page cannot tamper with and answers synchronously.
//
// Built-ins are saved at start, so a page that later replaces them cannot blind this script.

(() => {
  const MARK = '__scamfuseMainWorld';
  if ((window as unknown as Record<string, unknown>)[MARK]) return;
  Object.defineProperty(window, MARK, { value: true });

  const reflectApply = Reflect.apply;
  const defineProperty = Object.defineProperty;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const addListener = EventTarget.prototype.addEventListener;
  const stopImmediate = Event.prototype.stopImmediatePropagation;
  const CustomEventCtor = CustomEvent;
  const getAttribute = Element.prototype.getAttribute;
  const removeAttribute = Element.prototype.removeAttribute;
  const documentElementGetter = getOwnPropertyDescriptor(Document.prototype, 'documentElement')?.get;
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const now = Date.now;
  const StringCtor = String;
  const BlobCtor = Blob;
  const ClipboardItemCtor = typeof ClipboardItem === 'function' ? ClipboardItem : undefined;
  const doc = document;
  const VERDICT_ATTRIBUTE = 'data-scamfuse-verdict';

  let flagged = false;

  function send(type: string, detail: string): void {
    reflectApply(dispatch, doc, [new CustomEventCtor(type, { detail })]);
  }

  function signal(name: string): void {
    send('scamfuse:signal', name);
  }

  /** Returns the safe replacement when the text must not reach the clipboard. */
  function check(text: string, scriptWritten: boolean): string | null {
    const root = documentElementGetter ? (reflectApply(documentElementGetter, doc, []) as Element | null) : null;
    if (!root) return null;
    reflectApply(removeAttribute, root, [VERDICT_ATTRIBUTE]);
    send('scamfuse:clipboard', jsonStringify({ text, scriptWritten }));
    const raw = reflectApply(getAttribute, root, [VERDICT_ATTRIBUTE]) as string | null;
    reflectApply(removeAttribute, root, [VERDICT_ATTRIBUTE]);
    if (!raw) return null;
    try {
      const verdict = jsonParse(raw) as { block?: boolean; safe?: string };
      return verdict.block ? StringCtor(verdict.safe ?? '') : null;
    } catch {
      return null;
    }
  }

  function wrap<T extends object>(
    target: T | undefined,
    name: string,
    make: (original: (...args: unknown[]) => unknown) => (this: unknown, ...args: unknown[]) => unknown,
  ): void {
    if (!target) return;
    const descriptor = getOwnPropertyDescriptor(target, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as (...args: unknown[]) => unknown;
    defineProperty(target, name, { ...descriptor, value: make(original) });
  }

  // ------------------------------------------------------------ clipboard

  const clipboardProto = typeof Clipboard === 'function' ? Clipboard.prototype : undefined;

  wrap(clipboardProto, 'writeText', (original) =>
    function writeText(this: unknown, ...args: unknown[]) {
      const text = StringCtor(args[0]);
      const replacement = check(text, true);
      return reflectApply(original, this, replacement === null ? args : [replacement]);
    },
  );

  wrap(clipboardProto, 'write', (original) =>
    function write(this: unknown, ...args: unknown[]) {
      const items = args[0] as ClipboardItem[] | undefined;
      const first = items && items[0];
      if (!first || !ClipboardItemCtor || !first.types.includes('text/plain')) {
        return reflectApply(original, this, args);
      }
      return first
        .getType('text/plain')
        .then((blob) => blob.text())
        .then((text) => {
          const replacement = check(text, true);
          if (replacement === null) return reflectApply(original, this, args);
          const safeItem = new ClipboardItemCtor({
            'text/plain': new BlobCtor([replacement], { type: 'text/plain' }),
          });
          return reflectApply(original, this, [[safeItem]]);
        });
    },
  );

  // Copy handlers that put their own text into the clipboard.
  wrap(DataTransfer.prototype, 'setData', (original) =>
    function setData(this: unknown, ...args: unknown[]) {
      const format = StringCtor(args[0]).toLowerCase();
      if (format === 'text/plain' || format === 'text' || format === 'text/html') {
        const replacement = check(StringCtor(args[1]), true);
        if (replacement !== null) return reflectApply(original, this, [args[0], replacement]);
      }
      return reflectApply(original, this, args);
    },
  );

  // document.execCommand('copy') with a hidden text field: tell the isolated script that
  // the copy that follows comes from a script, not from the person.
  wrap(Document.prototype, 'execCommand', (original) =>
    function execCommand(this: unknown, ...args: unknown[]) {
      const command = StringCtor(args[0]).toLowerCase();
      if (command === 'copy' || command === 'cut') send('scamfuse:exec-copy', '1');
      return reflectApply(original, this, args);
    },
  );

  // ------------------------------------------------------------ fake alert behaviour

  const fullscreen = (original: (...args: unknown[]) => unknown) =>
    function requestFullscreen(this: unknown, ...args: unknown[]) {
      signal('fullscreen');
      return reflectApply(original, this, args);
    };
  wrap(Element.prototype, 'requestFullscreen', fullscreen);
  wrap(Element.prototype as unknown as Record<string, unknown>, 'webkitRequestFullscreen', fullscreen);

  const keyboard = (navigator as unknown as { keyboard?: object }).keyboard;
  if (keyboard) {
    wrap(Object.getPrototypeOf(keyboard) as object, 'lock', (original) =>
      function lock(this: unknown, ...args: unknown[]) {
        signal('keyboard-lock');
        return reflectApply(original, this, args);
      },
    );
  }

  const dialogTimes: number[] = [];
  for (const name of ['alert', 'confirm', 'prompt'] as const) {
    wrap(window, name, (original) =>
      function dialog(this: unknown, ...args: unknown[]) {
        const at = now();
        dialogTimes.push(at);
        while (dialogTimes.length && at - (dialogTimes[0] ?? at) > 10_000) dialogTimes.shift();
        if (dialogTimes.length >= 3) signal('dialog-loop');
        if (flagged || dialogTimes.length > 3) {
          return name === 'confirm' ? false : name === 'prompt' ? null : undefined;
        }
        return reflectApply(original, this, args);
      },
    );
  }

  const pushTimes: number[] = [];
  wrap(History.prototype, 'pushState', (original) =>
    function pushState(this: unknown, ...args: unknown[]) {
      const at = now();
      pushTimes.push(at);
      while (pushTimes.length && at - (pushTimes[0] ?? at) > 3000) pushTimes.shift();
      if (pushTimes.length >= 5) signal('history-trap');
      return reflectApply(original, this, args);
    },
  );

  // After the page is recognised as a trap, it may no longer hold the tab with "Leave site?".
  reflectApply(addListener, window, [
    'beforeunload',
    (event: Event) => {
      if (flagged) reflectApply(stopImmediate, event, []);
    },
    true,
  ]);
  reflectApply(addListener, doc, [
    'scamfuse:flagged',
    () => {
      flagged = true;
    },
    true,
  ]);
})();
