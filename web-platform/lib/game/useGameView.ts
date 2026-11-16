"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, gameApi } from "./api";
import type { GameView } from "./types";

interface State {
  view: GameView | null;
  /**
   * Mốc thời gian (performance.now) mà `view` được tính ra, đã bù một nửa độ trễ
   * mạng. Đồng hồ hiển thị = số liệu server trừ đi (bây giờ - mốc này), nên KHÔNG
   * phụ thuộc đồng hồ máy khách có đúng giờ hay không.
   */
  baselinePerf: number;
  error: string | null;
  notFound: boolean;
}

const POLL_WAITING_MS = 1500;
const POLL_PLAYER_MS = 1000;
const POLL_SPECTATOR_MS = 2000;

export function useGameView(gameId: string) {
  const [state, setState] = useState<State>({
    view: null,
    baselinePerf: 0,
    error: null,
    notFound: false,
  });
  const viewRef = useRef<GameView | null>(null);
  const pollNowRef = useRef<() => void>(() => {});

  const applyView = useCallback((view: GameView, baselinePerf: number) => {
    const current = viewRef.current;
    // Bỏ qua phản hồi cũ đến muộn (poll chậm hơn một thao tác vừa xong).
    if (current && view.serverNowMs < current.serverNowMs) return;
    viewRef.current = view;
    setState({ view, baselinePerf, error: null, notFound: false });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    function schedule() {
      if (cancelled) return;
      const view = viewRef.current;
      if (view && (view.status === "finished" || view.status === "aborted")) return;
      const delay =
        view?.status === "waiting"
          ? POLL_WAITING_MS
          : view?.viewer.side
            ? POLL_PLAYER_MS
            : POLL_SPECTATOR_MS;
      timer = setTimeout(() => void poll(), delay);
    }

    async function poll() {
      if (inFlight || cancelled) return;
      inFlight = true;
      if (timer) clearTimeout(timer);
      const started = performance.now();
      try {
        const view = await gameApi.view(gameId, controller.signal);
        if (cancelled) return;
        applyView(view, started + (performance.now() - started) / 2);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setState((previous) => ({ ...previous, notFound: true }));
          return;
        }
        setState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "Có lỗi xảy ra.",
        }));
      } finally {
        inFlight = false;
      }
      schedule();
    }

    pollNowRef.current = () => void poll();
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [gameId, applyView]);

  /** Hỏi server ngay (ví dụ khi đồng hồ vừa về 0). */
  const refresh = useCallback(() => pollNowRef.current(), []);

  /** Nhận trạng thái mới từ phản hồi của một thao tác (đi quân, xin thua...). */
  const acceptView = useCallback(
    (view: GameView) => applyView(view, performance.now()),
    [applyView],
  );

  return { ...state, refresh, acceptView };
}
