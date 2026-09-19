import { useLayoutEffect, useRef, useState } from "react";

export function useAdaptiveToolbar(groupCount: number) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ visibleCount: groupCount, width: 0 });

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const measure = measureRef.current;
    const pinned = pinnedRef.current;
    const trailing = trailingRef.current;
    if (!toolbar || !measure || !pinned || !trailing) {
      return;
    }
    let frame = 0;
    const update = () => {
      const width = toolbar.clientWidth;
      if (!width) {
        return;
      }
      const style = getComputedStyle(toolbar);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const available = width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - 2;
      const pinnedWidth = pinned.getBoundingClientRect().width;
      const trailingWidth = trailing.getBoundingClientRect().width;
      const fixedWidth = pinnedWidth + (trailingWidth ? trailingWidth + gap : 0);
      const children = Array.from(measure.children);
      const moreWidth = children[0].getBoundingClientRect().width;
      const widths = children.slice(1).map((element) => element.getBoundingClientRect().width);
      const fullWidth = fixedWidth + widths.reduce((total, value) => total + value + gap, 0);
      let visibleCount = widths.length;
      if (fullWidth > available) {
        // Reserve More before fitting groups. Measurements always include every
        // group, so hiding a button cannot change its own fit threshold.
        let used = fixedWidth + moreWidth + gap;
        visibleCount = 0;
        for (const groupWidth of widths) {
          if (used + groupWidth + gap > available) {
            break;
          }
          used += groupWidth + gap;
          visibleCount += 1;
        }
      }
      setLayout((current) => current.visibleCount === visibleCount && current.width === width
        ? current
        : { visibleCount, width });
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(toolbar);
    observer.observe(pinned);
    observer.observe(trailing);
    for (const child of measure.children) {
      observer.observe(child);
    }
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [groupCount]);

  return { toolbarRef, measureRef, pinnedRef, trailingRef, ...layout };
}
