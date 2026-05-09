declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    _hmt?: unknown[];
  }
}

const defaultGoogleAnalyticsId = "G-9VKCGJ2TSZ";
const defaultBaiduTongjiId = "6e2b5eae2bbfdfc895a99c635fb9e384";

export function installAnalytics() {
  installGoogleAnalytics(import.meta.env.VITE_GA_ID || defaultGoogleAnalyticsId);
  installBaiduTongji(import.meta.env.VITE_BAIDU_TONGJI_ID || defaultBaiduTongjiId);
}

function installGoogleAnalytics(id: string) {
  if (!id || document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${id}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);
}

function installBaiduTongji(id: string) {
  if (!id || document.querySelector(`script[src*="hm.baidu.com/hm.js?${id}"]`)) {
    return;
  }

  window._hmt = window._hmt || [];
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://hm.baidu.com/hm.js?${encodeURIComponent(id)}`;
  const firstScript = document.getElementsByTagName("script")[0];
  firstScript.parentNode?.insertBefore(script, firstScript);
}

export {};
