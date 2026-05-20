import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

export type ResizeEdge = 'left' | 'right';

export interface PanelWidthConstraints {
  min: number;
  max: number;
}

export interface DraggedPanelWidthInput {
  edge: ResizeEdge;
  startClientX: number;
  currentClientX: number;
  startWidth: number;
  constraints: PanelWidthConstraints;
}

interface ResizablePanelOptions {
  defaultWidth: number;
  constraints: PanelWidthConstraints;
  edge: ResizeEdge;
}

export function clampPanelWidth(width: number, constraints: PanelWidthConstraints) {
  return Math.min(Math.max(width, constraints.min), constraints.max);
}

export function getDraggedPanelWidth({
  edge,
  startClientX,
  currentClientX,
  startWidth,
  constraints,
}: DraggedPanelWidthInput) {
  const delta = currentClientX - startClientX;
  const nextWidth = edge === 'right' ? startWidth + delta : startWidth - delta;

  return clampPanelWidth(nextWidth, constraints);
}

export function useResizablePanel({
  defaultWidth,
  constraints,
  edge,
}: ResizablePanelOptions) {
  const [width, setWidth] = useState(() => clampPanelWidth(defaultWidth, constraints));
  const dragStateRef = useRef<{ startClientX: number; startWidth: number } | null>(null);

  const resizeBy = useCallback((delta: number) => {
    setWidth((currentWidth) => clampPanelWidth(currentWidth + delta, constraints));
  }, [constraints]);

  const startResize = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startClientX: event.clientX,
      startWidth: width,
    };
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) {
        return;
      }

      setWidth(getDraggedPanelWidth({
        edge,
        startClientX: dragState.startClientX,
        currentClientX: event.clientX,
        startWidth: dragState.startWidth,
        constraints,
      }));
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    const handleMouseDownCursor = () => {
      if (!dragStateRef.current) {
        return;
      }
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousemove', handleMouseDownCursor);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousemove', handleMouseDownCursor);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [constraints, edge]);

  return {
    width,
    resizeBy,
    startResize,
  };
}
