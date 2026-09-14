(() => {
  const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

  function graphemes(text) {
    if (segmenter) return Array.from(segmenter.segment(text), part => part.segment);
    return Array.from(text);
  }

  function decorateCategoryHeader(header) {
    if (!header || header.querySelector('.category-emoji-fix')) return;

    const text = header.textContent || '';
    if (!EMOJI_RE.test(text)) return;

    const fragment = document.createDocumentFragment();
    for (const part of graphemes(text)) {
      if (EMOJI_RE.test(part)) {
        const emoji = document.createElement('span');
        emoji.className = 'category-emoji-fix';
        emoji.textContent = part;
        fragment.appendChild(emoji);
      } else {
        fragment.appendChild(document.createTextNode(part));
      }
    }

    header.replaceChildren(fragment);
  }

  function applyCategoryEmojiFixes() {
    document.querySelectorAll('.category-column-header h3').forEach(decorateCategoryHeader);
  }

  let scheduled = false;
  function scheduleFix() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyCategoryEmojiFixes();
    });
  }

  function start() {
    applyCategoryEmojiFixes();

    const container = document.getElementById('full-view-container');
    if (!container) return;

    const observer = new MutationObserver(scheduleFix);
    observer.observe(container, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
