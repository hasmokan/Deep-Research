'use client';

import { useEffect, type RefObject } from 'react';

interface UseConversationAutoscrollOptions {
  conversationEndRef: RefObject<HTMLDivElement | null>;
  conversationScrollRef: RefObject<HTMLDivElement | null>;
  isEnabled: boolean;
  scrollSignature: string;
}

export function useConversationAutoscroll({
  conversationEndRef,
  conversationScrollRef,
  isEnabled,
  scrollSignature,
}: UseConversationAutoscrollOptions) {
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    window.requestAnimationFrame(() => {
      const scrollContainer = conversationScrollRef.current;
      if (!scrollContainer) {
        conversationEndRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'end',
        });
        return;
      }

      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, [
    conversationEndRef,
    conversationScrollRef,
    isEnabled,
    scrollSignature,
  ]);
}
