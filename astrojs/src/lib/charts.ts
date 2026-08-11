/**
 * Selective ECharts build + common options for Nothing OS palette:
 * black background, graphite axes, white/gray series, red — heart only.
 */
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  GraphicComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  GraphicComponent,
  CanvasRenderer,
]);

export { echarts };

// ─── Nothing OS Palette ─────────────────────────────────────────────────────
export const RED = '#d71921';    // single accent — heart
export const RED_TEXT = '#ff4d54'; // lighter for small text (WCAG AA on #000)
export const WHITE = '#f2f2f2';
export const GRAY = '#8a8a8a';
export const GRAY_LT = '#c4c4c4';
export const DIM = '#3d3d3d';

export const AXIS_COLOR = '#1f1f1f';
export const LABEL_COLOR = '#7a7a7a';
const TOOLTIP_BG = '#000000';

/** Base chart options: transparent background, thin axes, black tooltip. */
export function baseOpts(): Record<string, unknown> {
  return {
    backgroundColor: 'transparent',
    animationDuration: 500,
    textStyle: { fontFamily: "'IBM Plex Mono', monospace" },
    tooltip: {
      backgroundColor: TOOLTIP_BG,
      borderColor: DIM,
      textStyle: { color: WHITE, fontSize: 11 },
    },
    grid: { left: 38, right: 12, top: 12, bottom: 22 },
  };
}

export function timeAxis(): Record<string, unknown> {
  return {
    type: 'category',
    axisLine: { lineStyle: { color: AXIS_COLOR } },
    axisTick: { show: false },
    axisLabel: { color: LABEL_COLOR, fontSize: 10 },
  };
}

export function valueAxis(unit = ''): Record<string, unknown> {
  return {
    type: 'value',
    splitLine: { lineStyle: { color: AXIS_COLOR, opacity: 0.35 } },
    axisLabel: {
      color: LABEL_COLOR,
      fontSize: 10,
      formatter: (v: number) => `${v}${unit}`,
    },
  };
}

/** Initialize chart in container + resize. */
export function initChart(el: HTMLElement): echarts.ECharts {
  const chart = echarts.init(el);
  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(el);
  // dispose must remove the observer: SleepCard recreates DOM every 60 s,
  // and without this each cycle left a ResizeObserver with a closure on a dead
  // chart (leak of ECharts instances + canvases).
  const origDispose = chart.dispose.bind(chart);
  chart.dispose = (): void => {
    ro.disconnect();
    origDispose();
  };
  return chart;
}

/**
 * Empty chart state: muted label centered instead of a hole with
 * a hanging label. notMerge=true — the next setOption with data (also with
 * notMerge) will erase this graphic automatically.
 */
export function paintEmpty(chart: echarts.ECharts, label = 'no data'): void {
  chart.setOption(
    {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: { show: false },
      xAxis: { show: false, type: 'category', data: [] },
      yAxis: { show: false, type: 'value' },
      series: [],
      graphic: [
        {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: label,
            fill: LABEL_COLOR,
            fontSize: 11,
            fontFamily: "'IBM Plex Mono', monospace",
          },
        },
      ],
    },
    true,
  );
}

/**
 * Render the current chart to a data URL (PNG by default) or SVG for download.
 * Returns `null` on error / no instance.
 */
export function chartDataUrl(
  chart: echarts.ECharts | undefined | null,
  format: 'png' | 'svg' = 'png',
): string | null {
  if (!chart) return null;
  try {
    const isSvg = format === 'svg';
    // SVG renderer is not bundled here; PNG is the reliable path.
    if (isSvg) return null;
    const url = chart.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#000000',
    });
    return typeof url === 'string' && url.length ? url : null;
  } catch {
    return null;
  }
}

/** Trigger a download of a data URL (PNG) with the configured stem + date. */
export function downloadChartPng(
  chart: echarts.ECharts | undefined | null,
  stem: string,
): boolean {
  const url = chartDataUrl(chart, 'png');
  if (!url) return false;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stem}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}
