import { AlertTriangle, Check, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import type {
  AiPolishSelectionProgress,
  AiPolishSelectionProgressPhase,
  AiPolishSelectionResult,
  AiSettingsInfo
} from "../../shared/types";

export interface AiSelectionPolishLabels {
  action: string;
  loading: string;
  cancelLoading: string;
  streamingTitle: string;
  connecting: string;
  thinking: string;
  writing: (count: number) => string;
  waitingForText: string;
  previewTitle: string;
  previewDescription: string;
  original: string;
  polished: string;
  replace: string;
  cancel: string;
  close: string;
  retry: string;
  notConfiguredTitle: string;
  notConfiguredBody: string;
  failedTitle: string;
  unchangedTitle: string;
  unchangedBody: string;
  selectionChanged: string;
  replaceFailed: string;
}

export interface AiSelectionPolishAnchor {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type AiSelectionPolishReplaceResult = "ok" | "selection-changed" | "replace-failed";

export interface AiSelectionPolishCandidate {
  sourceText: string;
  anchor: AiSelectionPolishAnchor;
  isCurrent: () => boolean;
  replace: (replacement: string) => AiSelectionPolishReplaceResult;
}

interface AiSelectionPolishContextValue {
  setCandidate: (owner: string, candidate: AiSelectionPolishCandidate | null) => void;
  clearCandidate: (owner: string) => void;
}

interface OwnedCandidate {
  owner: string;
  candidate: AiSelectionPolishCandidate;
}

type DialogState =
  | {
      kind: "streaming";
      requestId: string;
      target: AiSelectionPolishCandidate;
      streamedText: string;
      phase: AiPolishSelectionProgressPhase;
      receivedCharacters: number;
    }
  | {
      kind: "preview";
      target: AiSelectionPolishCandidate;
      polishedText: string;
    }
  | {
      kind: "error" | "not-configured" | "selection-changed" | "unchanged";
      target: AiSelectionPolishCandidate;
      message: string;
      retryable: boolean;
    };

const emptyContext: AiSelectionPolishContextValue = {
  setCandidate: () => undefined,
  clearCandidate: () => undefined
};

const AiSelectionPolishContext = createContext<AiSelectionPolishContextValue>(emptyContext);

function buttonPosition(anchor: AiSelectionPolishAnchor, loading: boolean): { left: number; top: number } {
  const width = loading ? 138 : 112;
  const height = 38;
  const gap = 8;
  const preferredTop = anchor.bottom + gap;
  const fallbackTop = anchor.top - height - gap;
  const maxTop = Math.max(gap, window.innerHeight - height - gap);
  const desiredTop = preferredTop + height <= window.innerHeight - gap ? preferredTop : fallbackTop;
  const top = Math.max(gap, Math.min(desiredTop, maxTop));
  const centeredLeft = (anchor.left + anchor.right - width) / 2;
  return {
    left: Math.max(gap, Math.min(centeredLeft, window.innerWidth - width - gap)),
    top
  };
}

export function useAiSelectionPolish(): AiSelectionPolishContextValue {
  return useContext(AiSelectionPolishContext);
}

export function AiSelectionPolishProvider({
  settings,
  labels,
  children
}: {
  settings: AiSettingsInfo | null;
  labels: AiSelectionPolishLabels;
  children: ReactNode;
}) {
  const configured = Boolean(
    settings?.enabled && settings.apiKeyConfigured && settings.baseUrl.trim() && settings.model.trim()
  );
  const [ownedCandidate, setOwnedCandidate] = useState<OwnedCandidate | null>(null);
  const [loadingTarget, setLoadingTarget] = useState<AiSelectionPolishCandidate | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const interactionLockedRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const streamingOutputRef = useRef<HTMLPreElement>(null);
  const dialogTitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const setCandidate = useCallback((owner: string, candidate: AiSelectionPolishCandidate | null) => {
    if (interactionLockedRef.current) {
      return;
    }
    setOwnedCandidate((current) => {
      if (!candidate) {
        return current?.owner === owner ? null : current;
      }
      return { owner, candidate };
    });
  }, []);

  const clearCandidate = useCallback((owner: string) => {
    if (interactionLockedRef.current) {
      return;
    }
    setOwnedCandidate((current) => (current?.owner === owner ? null : current));
  }, []);

  const cancelPendingRequest = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) {
      return;
    }
    activeRequestIdRef.current = null;
    void window.workJournal.ai.cancelPolishSelection(requestId).catch(() => undefined);
  }, []);

  const resetInteraction = useCallback(() => {
    cancelPendingRequest();
    requestSequenceRef.current += 1;
    interactionLockedRef.current = false;
    setLoadingTarget(null);
    setDialog(null);
    setOwnedCandidate(null);
  }, [cancelPendingRequest]);

  useEffect(
    () => () => {
      requestSequenceRef.current += 1;
      cancelPendingRequest();
    },
    [cancelPendingRequest]
  );

  const dialogKind = dialog?.kind ?? null;
  useEffect(() => {
    if (!dialogKind) {
      return;
    }
    closeButtonRef.current?.focus();
  }, [dialogKind]);

  const hasActiveUi = Boolean(dialog || loadingTarget);
  useEffect(() => {
    if (!hasActiveUi) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        resetInteraction();
      }
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [hasActiveUi, resetInteraction]);

  useEffect(() => {
    const subscribe = window.workJournal.ai.onPolishSelectionProgress;
    if (typeof subscribe !== "function") {
      return;
    }

    let frame: number | null = null;
    let pendingRequestId: string | null = null;
    let pendingDelta = "";
    let pendingPhase: AiPolishSelectionProgressPhase = "connecting";
    let pendingCharacterCount = 0;

    const flush = () => {
      frame = null;
      const requestId = pendingRequestId;
      const delta = pendingDelta;
      const phase = pendingPhase;
      const receivedCharacters = pendingCharacterCount;
      pendingDelta = "";
      if (!requestId) {
        return;
      }
      setDialog((current) =>
        current?.kind === "streaming" && current.requestId === requestId
          ? {
              ...current,
              streamedText: current.streamedText + delta,
              phase,
              receivedCharacters
            }
          : current
      );
    };

    const unsubscribe = subscribe((progress: AiPolishSelectionProgress) => {
      if (progress.requestId !== activeRequestIdRef.current) {
        return;
      }
      if (pendingRequestId !== progress.requestId) {
        pendingRequestId = progress.requestId;
        pendingDelta = "";
      }
      pendingDelta += progress.delta ?? "";
      pendingPhase = progress.phase;
      pendingCharacterCount = progress.receivedCharacters;
      if (frame === null) {
        frame = window.requestAnimationFrame(flush);
      }
    });

    return () => {
      unsubscribe();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  const streamingText = dialog?.kind === "streaming" ? dialog.streamedText : null;
  useEffect(() => {
    if (streamingText === null || !streamingOutputRef.current) {
      return;
    }
    streamingOutputRef.current.scrollTop = streamingOutputRef.current.scrollHeight;
  }, [streamingText]);

  const requestPolish = useCallback(
    async (target: AiSelectionPolishCandidate) => {
      interactionLockedRef.current = true;
      setOwnedCandidate(null);
      if (!configured) {
        setDialog({
          kind: "not-configured",
          target,
          message: labels.notConfiguredBody,
          retryable: false
        });
        return;
      }
      if (!target.isCurrent()) {
        setDialog({
          kind: "selection-changed",
          target,
          message: labels.selectionChanged,
          retryable: false
        });
        return;
      }

      const requestSequence = ++requestSequenceRef.current;
      const requestId = crypto.randomUUID();
      activeRequestIdRef.current = requestId;
      setLoadingTarget(target);
      setDialog({
        kind: "streaming",
        requestId,
        target,
        streamedText: "",
        phase: "connecting",
        receivedCharacters: 0
      });
      let result: AiPolishSelectionResult;
      try {
        result = await window.workJournal.ai.polishSelection({ requestId, text: target.sourceText });
      } catch (error) {
        if (activeRequestIdRef.current === requestId) {
          activeRequestIdRef.current = null;
        }
        if (requestSequence !== requestSequenceRef.current) {
          return;
        }
        setLoadingTarget(null);
        setDialog({
          kind: "error",
          target,
          message: error instanceof Error ? error.message : labels.failedTitle,
          retryable: target.isCurrent()
        });
        return;
      }
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = null;
      }
      if (requestSequence !== requestSequenceRef.current) {
        return;
      }
      setLoadingTarget(null);
      if (!result.success || typeof result.polishedText !== "string" || !result.polishedText.trim()) {
        setDialog({
          kind: "error",
          target,
          message: result.error || labels.failedTitle,
          retryable: target.isCurrent()
        });
        return;
      }
      const normalizedSource = target.sourceText.replace(/\r\n?/g, "\n").trim();
      const normalizedResult = result.polishedText.replace(/\r\n?/g, "\n").trim();
      if (normalizedResult === normalizedSource) {
        setDialog({
          kind: "unchanged",
          target,
          message: labels.unchangedBody,
          retryable: target.isCurrent()
        });
        return;
      }
      setDialog({
        kind: "preview",
        target,
        polishedText: result.polishedText
      });
    },
    [configured, labels.failedTitle, labels.notConfiguredBody, labels.selectionChanged, labels.unchangedBody]
  );

  const replaceSelection = () => {
    if (!dialog || dialog.kind !== "preview") {
      return;
    }
    if (!dialog.target.isCurrent()) {
      setDialog({
        kind: "selection-changed",
        target: dialog.target,
        message: labels.selectionChanged,
        retryable: false
      });
      return;
    }
    const result = dialog.target.replace(dialog.polishedText);
    if (result === "ok") {
      resetInteraction();
      return;
    }
    setDialog({
      kind: result === "replace-failed" ? "error" : "selection-changed",
      target: dialog.target,
      message: result === "replace-failed" ? labels.replaceFailed : labels.selectionChanged,
      retryable: false
    });
  };

  const contextValue = useMemo<AiSelectionPolishContextValue>(
    () => ({ setCandidate, clearCandidate }),
    [clearCandidate, setCandidate]
  );
  const visibleTarget = loadingTarget ?? ownedCandidate?.candidate ?? null;
  const floatingPosition = visibleTarget ? buttonPosition(visibleTarget.anchor, Boolean(loadingTarget)) : null;
  const streamingStatus =
    dialog?.kind === "streaming"
      ? dialog.phase === "connecting"
        ? labels.connecting
        : dialog.phase === "thinking"
          ? labels.thinking
          : labels.writing(dialog.receivedCharacters)
      : "";

  const floatingButton = visibleTarget && floatingPosition && !dialog
    ? createPortal(
        <button
          className={`ai-selection-polish-trigger${loadingTarget ? " is-loading" : ""}`}
          data-ai-selection-polish-ui
          type="button"
          style={floatingPosition}
          aria-live="polite"
          aria-busy={Boolean(loadingTarget)}
          aria-label={loadingTarget ? labels.cancelLoading : labels.action}
          title={loadingTarget ? labels.cancelLoading : undefined}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (loadingTarget) {
              resetInteraction();
              return;
            }
            void requestPolish(visibleTarget);
          }}
        >
          {loadingTarget ? (
            <>
              <span className="ai-selection-polish-spinner" aria-hidden="true">
                <LoaderCircle size={15} />
              </span>
              <span>{labels.loading}</span>
              <X className="ai-selection-polish-cancel-icon" size={14} aria-hidden="true" />
            </>
          ) : (
            <>
              <Sparkles size={15} aria-hidden="true" />
              <span>{labels.action}</span>
            </>
          )}
        </button>,
        document.body
      )
    : null;

  const dialogPortal = dialog
    ? createPortal(
        <div className="ai-selection-polish-backdrop" data-ai-selection-polish-ui role="presentation">
          <section
            className="ai-selection-polish-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <header className="ai-selection-polish-dialog-header">
              <span className="ai-selection-polish-dialog-icon" aria-hidden="true">
                {dialog.kind === "streaming" ? (
                  <LoaderCircle className="ai-selection-polish-spinner" size={18} />
                ) : dialog.kind === "preview" ? (
                  <Sparkles size={18} />
                ) : (
                  <AlertTriangle size={18} />
                )}
              </span>
              <div>
                <h2 id={dialogTitleId}>
                  {dialog.kind === "streaming"
                    ? labels.streamingTitle
                    : dialog.kind === "preview"
                    ? labels.previewTitle
                    : dialog.kind === "not-configured"
                      ? labels.notConfiguredTitle
                      : dialog.kind === "unchanged"
                        ? labels.unchangedTitle
                      : labels.failedTitle}
                </h2>
                <p aria-live="polite">
                  {dialog.kind === "streaming"
                    ? streamingStatus
                    : dialog.kind === "preview"
                      ? labels.previewDescription
                      : dialog.message}
                </p>
              </div>
              <button
                ref={closeButtonRef}
                className="icon-button"
                type="button"
                aria-label={labels.close}
                onClick={resetInteraction}
              >
                <X size={17} />
              </button>
            </header>

            {(dialog.kind === "streaming" || dialog.kind === "preview") && (
              <div
                className={`ai-selection-polish-comparison${dialog.kind === "streaming" ? " is-streaming" : ""}`}
                aria-busy={dialog.kind === "streaming"}
              >
                <section>
                  <span>{labels.original}</span>
                  <pre>{dialog.target.sourceText}</pre>
                </section>
                <section>
                  <span>{labels.polished}</span>
                  <pre
                    ref={dialog.kind === "streaming" ? streamingOutputRef : undefined}
                    className={
                      dialog.kind === "streaming"
                        ? `is-streaming${dialog.streamedText ? "" : " is-empty"}`
                        : undefined
                    }
                  >
                    {dialog.kind === "streaming"
                      ? dialog.streamedText || labels.waitingForText
                      : dialog.polishedText}
                  </pre>
                </section>
              </div>
            )}

            <footer className="ai-selection-polish-dialog-actions">
              <button className="secondary-button" type="button" onClick={resetInteraction}>
                {labels.cancel}
              </button>
              {(dialog.kind === "error" || dialog.kind === "unchanged") && dialog.retryable && (
                <button className="secondary-button" type="button" onClick={() => void requestPolish(dialog.target)}>
                  <RefreshCw size={16} />
                  {labels.retry}
                </button>
              )}
              {dialog.kind === "preview" && (
                <button
                  className="primary-button"
                  type="button"
                  onClick={replaceSelection}
                >
                  <Check size={16} />
                  {labels.replace}
                </button>
              )}
            </footer>
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <AiSelectionPolishContext.Provider value={contextValue}>
      {children}
      {floatingButton}
      {dialogPortal}
    </AiSelectionPolishContext.Provider>
  );
}
