(() => {
  // 完全一致で判定するチャンネル名（SPA ナビゲーション後の DOM 参照用）
  const TARGET_NAMES = [
    'Kanata Ch. 天音かなた',
    'Kanata Ch. Kanata Amane',
  ];

  // 月数 → 差し替え画像 URL の対応表
  // 月数は「新規=0, 1か月=1, 2か月=2 ...」の整数で管理する
  // chrome.runtime.getURL() で拡張機能内の画像を参照する
  const b = (file) => chrome.runtime.getURL('badges/' + file);

  const BADGE_BY_MONTHS = [
    { months: 0,  url: b('badge_0.png')  }, // 新規
    { months: 1,  url: b('badge_1.png')  }, // 1か月
    { months: 2,  url: b('badge_2.png')  }, // 2か月
    { months: 6,  url: b('badge_6.png')  }, // 6か月
    { months: 12, url: b('badge_12.png') }, // 1年
    { months: 24, url: b('badge_24.png') }, // 2年
    { months: 36, url: b('badge_36.jpg') }, // 3年
    { months: 48, url: b('badge_48.png') }, // 4年
    { months: 60, url: b('badge_60.png') }, // 5年
  ];

  // alt テキストから月数を抽出する（言語非依存）
  //
  // 対応パターン例:
  //   新規メンバー / New member / 신규 멤버 など → 0
  //   メンバー（2 年） / Member (2 years) / 멤버(2년) / Участник (2 года) → 24
  //   メンバー（6 か月） / Member (6 months) / 6개월 / 6 meses / 6个月 / 6個月 → 6
  function extractMonths(text) {
    if (!text) return null;

    // 「新規」系: new / 신규 / nuevo / nouveau / neu / 新 / baru のいずれかが含まれる
    if (/new\b|신규|nuevo|nouveau|neu\b|新|baru/i.test(text)) return 0;

    // 年数 × 12
    const yearMatch = text.match(/(\d+)\s*(?:年|년|years?|ans?|años?|Jahr(?:en)?|год(?:а|лет)?|năm|tahun)/i);
    if (yearMatch) return parseInt(yearMatch[1], 10) * 12;

    // 月数
    const monthMatch = text.match(/(\d+)\s*(?:か月|ヶ月|ヵ月|个月|個月|개월|months?|mois|Monat(?:en)?|mes(?:es)?|месяц(?:ев|а)?|tháng|bulan)/i);
    if (monthMatch) return parseInt(monthMatch[1], 10);

    return null;
  }

  // 月数から最も近い（以下で最大の）階級の画像 URL を返す
  function urlForMonths(months) {
    let result = null;
    for (const entry of BADGE_BY_MONTHS) {
      if (entry.months <= months) result = entry;
    }
    return result ? result.url : null;
  }
  const REPLACED_ATTR = 'data-kanata-memberstamp-replaced';

  let observer = null;
  let scanQueued = false;

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  const TARGET_CHANNEL_ID = 'UCZlDXzGoo7d44bwdNObFacg';

  // チャンネルを判定する。isolated world からアクセス可能な DOM のみ使用。
  // iframe では親ページも参照する。
  function isTargetChannelPage() {
    const docs = window !== window.top ? [window.top?.document, document] : [document];
    for (const doc of docs) {
      if (!doc) continue;
      try {
        // 方法1: <script> タグの JSON 内 channelId をパース（ページ初回ロード時に確実）
        for (const script of doc.querySelectorAll('script')) {
          if (!script.textContent.includes('channelId')) continue;
          const m = script.textContent.match(/"channelId":"(UC[\w-]{22})"/);
          if (m && m[1] === TARGET_CHANNEL_ID) return true;
        }

        // 方法2: DOM テキスト（SPA ナビゲーション後など、要素が描画済みの場合）
        const selectors = [
          '#channel-name yt-formatted-string',
          '#owner-name a',
          'ytd-channel-name yt-formatted-string',
        ];
        for (const sel of selectors) {
          const text = doc.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
          if (text && TARGET_NAMES.includes(text)) return true;
        }
      } catch (_) {}
    }
    return false;
  }

  function getReplacementUrl(imageElement) {
    const badgeText = normalizeText(
      imageElement.getAttribute('alt') ||
      imageElement.getAttribute('title') ||
      imageElement.getAttribute('aria-label')
    );

    const months = extractMonths(badgeText);
    if (months === null) return '';
    return urlForMonths(months) || '';
  }

  function replaceBadgeImage(imageElement) {
    if (imageElement.getAttribute(REPLACED_ATTR) === '1') {
      return;
    }

    const replacementUrl = getReplacementUrl(imageElement);
    if (!replacementUrl) {
      return;
    }

    imageElement.src = replacementUrl;
    imageElement.srcset = '';
    imageElement.setAttribute(REPLACED_ATTR, '1');
  }

  // バッジ画像は yt-live-chat-author-badge-renderer 内の img で、
  // alt に月数テキストが入る。言語非依存のため img 全件を対象にして
  // extractMonths でフィルタする。
  function scanPage() {
    if (!isTargetChannelPage()) {
      return;
    }

    const badgeImages = document.querySelectorAll('yt-live-chat-author-badge-renderer img');
    badgeImages.forEach(replaceBadgeImage);
  }

  function queueScan() {
    if (scanQueued) {
      return;
    }

    scanQueued = true;
    window.requestAnimationFrame(() => {
      scanQueued = false;
      scanPage();
    });
  }

  function startObserver() {
    if (observer) {
      return;
    }

    observer = new MutationObserver(queueScan);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['alt', 'src', 'srcset']
    });
  }

  function hookNavigationEvents() {
    const dispatchRouteChange = () => window.dispatchEvent(new Event('kanata-route-change'));
    const pushState = history.pushState;
    const replaceState = history.replaceState;

    history.pushState = function pushStatePatched(...args) {
      const result = pushState.apply(this, args);
      dispatchRouteChange();
      return result;
    };

    history.replaceState = function replaceStatePatched(...args) {
      const result = replaceState.apply(this, args);
      dispatchRouteChange();
      return result;
    };

    window.addEventListener('popstate', dispatchRouteChange);
    window.addEventListener('kanata-route-change', queueScan);
  }

  function boot() {
    hookNavigationEvents();
    startObserver();
    queueScan();
    window.addEventListener('load', queueScan, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();