import { useEffect, useState } from 'react';

export const TYPEWRITER_INTERVAL_MS = 18;
export const TYPEWRITER_STEP = 3;

export function getNextTypewriterText(
  targetText: string,
  currentText: string,
  step: number = TYPEWRITER_STEP,
) {
  const stablePrefix = targetText.startsWith(currentText) ? currentText : '';

  if (stablePrefix.length >= targetText.length) {
    return targetText;
  }

  return targetText.slice(0, Math.min(targetText.length, stablePrefix.length + step));
}

export function useTypewriterText(text: string, enabled: boolean) {
  const [visibleText, setVisibleText] = useState(enabled ? '' : text);

  useEffect(() => {
    if (!enabled || !text) {
      return;
    }

    const timer = window.setInterval(() => {
      setVisibleText((current) => getNextTypewriterText(text, current));
    }, TYPEWRITER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, text]);

  if (!enabled) {
    return text;
  }

  if (!text) {
    return '';
  }

  return text.startsWith(visibleText) ? visibleText : '';
}
