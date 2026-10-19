import { useEffect, useRef, useState } from 'react';

/** A4 bei 96 dpi */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

/** Zeigt das Druck-HTML maßstabsgetreu als A4-Blatt, skaliert auf die verfügbare Breite. */
export function PaperPreview({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(Math.min(1, entry.contentRect.width / A4_WIDTH)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="paper-wrap">
      <div className="paper" style={{ width: A4_WIDTH * scale, height: A4_HEIGHT * scale }}>
        <iframe
          title="Druckvorschau"
          sandbox=""
          srcDoc={html}
          style={{ width: A4_WIDTH, height: A4_HEIGHT, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
