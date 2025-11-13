import React, { useState, useEffect, useRef, useCallback } from "react";
import pkg from "../../../package.json" with { type: "json" };
import fs from "fs";
import path from "path";
import os from "os";

import { Box, Text, DOMElement } from "ink";
import { GrokAgent, ChatEntry } from "../../agent/grok-agent.js";
import { GrokToolCall } from "../../grok/client.js";
import { useInputHandler } from "../../hooks/use-input-handler.js";
import { LoadingSpinner } from "./loading-spinner.js";
import { CommandSuggestions } from "./command-suggestions.js";
import { ModelSelection } from "./model-selection.js";
import { ChatHistory } from "./chat-history.js";
import { ChatInput } from "./chat-input.js";
import { MCPStatus } from "./mcp-status.js";
import ConfirmationDialog from "./confirmation-dialog.js";
import { Banner } from "./banner.js";
import { ContextTooltip } from "./context-tooltip.js";
import { VersionNotification } from "./version-notification.js";
import {
  PlanModeIndicator,
  PlanModeStatusIndicator,
} from "./plan-mode-indicator.js";
import ContextIndicator from "./context-indicator.js";
import {
  ConfirmationService,
  ConfirmationOptions,
} from "../../utils/confirmation-service.js";
import ApiKeyInput from "./api-key-input.js";
import { useContextInfo } from "../../hooks/use-context-info.js";

interface ChatInterfaceProps {
  agent?: GrokAgent;
  initialMessage?: string;
}

// Main chat component that handles input when agent is available
function ChatInterfaceWithAgent({
  agent,
  initialMessage,
}: {
  agent: GrokAgent;
  initialMessage?: string;
}) {
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingTime, setProcessingTime] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmationOptions, setConfirmationOptions] =
    useState<ConfirmationOptions | null>(null);
  const [showContextTooltip, setShowContextTooltip] = useState(false);
  const scrollRef = useRef<DOMElement | null>(null);
  const processingStartTime = useRef<number>(0);
  const lastChatHistoryLength = useRef<number>(0);

  // Get context information for banner, tooltip, and context indicator
  const { contextInfo } = useContextInfo(agent);

  // Handle global keyboard shortcuts via input handler
  const handleGlobalShortcuts = (str: string, key: any) => {
    if (key.ctrl && (str === "i" || key.name === "i")) {
      setShowContextTooltip((prev) => !prev);
      return true;
    }
    return false;
  };

  const confirmationService = ConfirmationService.getInstance();

  // Disable input handler completely when confirmation is active to prevent flicker
  const inputHandlerEnabled = !confirmationOptions;
  
  const {
    input,
    cursorPosition,
    showCommandSuggestions,
    selectedCommandIndex,
    showModelSelection,
    selectedModelIndex,
    commandSuggestions,
    availableModels,
    autoEditEnabled,
    planMode,
  } = useInputHandler({
    agent,
    chatHistory,
    setChatHistory,
    setIsProcessing,
    setIsStreaming,
    setTokenCount,
    setProcessingTime,
    processingStartTime,
    isProcessing,
    isStreaming,
    isConfirmationActive: !!confirmationOptions,
    onGlobalShortcut: handleGlobalShortcuts,
  });

  // Simple handlers for missing functions
  const handleSubmit = useCallback(
    (message: string) => {
      if (!message.trim()) return;

      const userEntry: ChatEntry = {
        type: "user",
        content: message,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, userEntry]);

      // Process the message (simplified)
      setIsProcessing(true);
      setIsStreaming(true);

      // In a real implementation, this would call the agent
      setTimeout(() => {
        setIsProcessing(false);
        setIsStreaming(false);
      }, 1000);
    },
    [setChatHistory, setIsProcessing, setIsStreaming],
  );

  const handleCommandSelect = useCallback((command: string) => {
    // This should be handled by useInputHandler
  }, []);

  const handleModelSelect = useCallback((model: any) => {
    // This should be handled by useInputHandler
  }, []);

  useEffect(() => {
    // Only clear console on non-Windows platforms or if not PowerShell
    // Windows PowerShell can have issues with console.clear() causing flickering
    const isWindows = process.platform === "win32";
    const isPowerShell =
      process.env.ComSpec?.toLowerCase().includes("powershell") ||
      process.env.PSModulePath !== undefined;

    if (!isWindows || !isPowerShell) {
      console.clear();
    }

    // Add top padding
    console.log("    ");

    console.log(" ");

    // Generate welcome text with margin to match Ink paddingX={2}
    const logoOutput = "GROK CLI - HURRY MODE" + "\n" + pkg.version;

    const logoLines = logoOutput.split("\n");
    logoLines.forEach((line: string) => {
      if (line.trim()) {
        console.log(" " + line); // Add 2 spaces for horizontal margin
      } else {
        console.log(line); // Keep empty lines as-is
      }
    });

    console.log(" "); // Spacing after logo

    setChatHistory([]);
  }, []);

  // Session logging: append new chat entries to ~/.grok/session.log
  useEffect(() => {
    const newEntries = chatHistory.slice(lastChatHistoryLength.current);
    if (newEntries.length > 0) {
      const sessionFile = path.join(os.homedir(), ".grok", "session.log");
      try {
        const dir = path.dirname(sessionFile);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const lines =
          newEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
        fs.appendFileSync(sessionFile, lines);
      } catch {
        // Silently ignore session logging errors
      }
    }
    lastChatHistoryLength.current = chatHistory.length;
  }, [chatHistory]);

  // Process initial message if provided (streaming for faster feedback)
  useEffect(() => {
    if (initialMessage && agent) {
      const userEntry: ChatEntry = {
        type: "user",
        content: initialMessage,
        timestamp: new Date(),
      };
      setChatHistory([userEntry]);

      const processInitialMessage = async () => {
        setIsProcessing(true);
        setIsStreaming(true);

        try {
          let streamingEntry: ChatEntry | null = null;
          let accumulatedContent = "";
          let lastTokenCount = 0;
          let pendingToolCalls: GrokToolCall[] | null = null;
          let pendingToolResults: Array<{
            toolCall: GrokToolCall;
            toolResult: any;
          }> = [];
          let lastUpdateTime = Date.now();

          const flushUpdates = () => {
            const now = Date.now();
            if (now - lastUpdateTime < 250) return; // Throttle updates to prevent display corruption

            // Don't update if confirmation is active to prevent flicker
            if (confirmationOptions) return;

            // Batch all chat history updates into a single setState call
            setChatHistory((prev) => {
              let newHistory = [...prev];

              // Handle accumulated content immediately
              if (accumulatedContent) {
                if (!streamingEntry) {
                  // Create new streaming entry
                  const newStreamingEntry = {
                    type: "assistant" as const,
                    content: accumulatedContent,
                    timestamp: new Date(),
                    isStreaming: true,
                  };
                  newHistory.push(newStreamingEntry);
                  streamingEntry = newStreamingEntry;
                } else {
                  // Update existing streaming entry
                  const streamingIdx = newHistory.findIndex(
                    (entry) => entry.isStreaming,
                  );
                  if (streamingIdx >= 0) {
                    newHistory[streamingIdx] = {
                      ...newHistory[streamingIdx],
                      content:
                        newHistory[streamingIdx].content + accumulatedContent,
                    };
                  }
                }
                accumulatedContent = "";
              }

              // Handle pending tool calls
              if (pendingToolCalls) {
                // Mark streaming entry as complete
                const streamingIdx = newHistory.findIndex(
                  (entry) => entry.isStreaming,
                );
                if (streamingIdx >= 0) {
                  newHistory[streamingIdx] = {
                    ...newHistory[streamingIdx],
                    isStreaming: false,
                    toolCalls: pendingToolCalls,
                  };
                }
                streamingEntry = null;

                // Add individual tool call entries with descriptive messages
                pendingToolCalls.forEach((toolCall) => {
                  // Parse arguments to create descriptive message
                  let description = "Executing...";
                  try {
                    const args = JSON.parse(toolCall.function.arguments);
                    switch (toolCall.function.name) {
                      case "create_file":
                        description = `Creating file: ${args.path || args.file_path}`;
                        break;
                      case "str_replace_editor":
                        description = `Editing file: ${args.path || args.file_path}`;
                        break;
                      case "view_file":
                        description = `Reading file: ${args.path || args.file_path}`;
                        break;
                      case "bash":
                        description = `Running command: ${args.command?.substring(0, 60)}${args.command?.length > 60 ? '...' : ''}`;
                        break;
                      case "search":
                        description = `Searching for: ${args.query}`;
                        break;
                      default:
                        description = `Using ${toolCall.function.name}`;
                    }
                  } catch {
                    description = `Using ${toolCall.function.name}`;
                  }
                  
                  const toolCallEntry: ChatEntry = {
                    type: "tool_call",
                    content: description,
                    timestamp: new Date(),
                    toolCall: toolCall,
                  };
                  newHistory.push(toolCallEntry);
                });
                pendingToolCalls = null;
              }

              // Handle pending tool results
              if (pendingToolResults.length > 0) {
                newHistory = newHistory.map((entry) => {
                  if (entry.isStreaming) {
                    return { ...entry, isStreaming: false };
                  }
                  // Update matching tool_call entries
                  const matchingResult = pendingToolResults.find(
                    (result) =>
                      entry.type === "tool_call" &&
                      entry.toolCall?.id === result.toolCall.id,
                  );
                  if (matchingResult) {
                    // Create descriptive result message
                    let resultContent = "";
                    if (matchingResult.toolResult.success) {
                      const output = matchingResult.toolResult.output || "";
                      // Show first 200 chars of output for visibility
                      resultContent = output.length > 200 
                        ? output.substring(0, 200) + "..." 
                        : output || "✓ Success";
                    } else {
                      resultContent = `✗ Error: ${matchingResult.toolResult.error || "Unknown error"}`;
                    }
                    
                    return {
                      ...entry,
                      type: "tool_result",
                      content: resultContent,
                      toolResult: matchingResult.toolResult,
                    };
                  }
                  return entry;
                });
                streamingEntry = null;
                pendingToolResults = [];
              }

              return newHistory;
            });

            // Update token count separately
            if (lastTokenCount !== 0) {
              setTokenCount(lastTokenCount);
            }

            lastUpdateTime = now;
          };

          for await (const chunk of agent.processUserMessageStream(
            initialMessage,
          )) {
            switch (chunk.type) {
              case "content":
                if (chunk.content) {
                  accumulatedContent += chunk.content;
                }
                break;

              case "completion":
                // Completion message - create a new assistant entry immediately
                if (chunk.content) {
                  flushUpdates(); // Flush any pending updates first
                  setChatHistory((prev) => [
                    ...prev,
                    {
                      type: "assistant",
                      content: chunk.content!,
                      timestamp: new Date(),
                    },
                  ]);
                }
                break;

              case "token_count":
                if (chunk.tokenCount !== undefined) {
                  lastTokenCount = chunk.tokenCount;
                }
                break;

              case "tool_calls":
                if (chunk.toolCalls) {
                  pendingToolCalls = chunk.toolCalls;
                }
                break;

              case "tool_result":
                if (chunk.toolCall && chunk.toolResult) {
                  pendingToolResults.push({
                    toolCall: chunk.toolCall,
                    toolResult: chunk.toolResult,
                  });
                }
                break;

              case "done":
                // Flush all remaining updates
                flushUpdates();
                break;
            }

            // Flush updates more frequently during streaming
            flushUpdates();
          }

          // Final flush and cleanup
          flushUpdates();
          if (streamingEntry) {
            setChatHistory((prev) =>
              prev.map((entry) =>
                entry.isStreaming ? { ...entry, isStreaming: false } : entry,
              ),
            );
          }
          setIsStreaming(false);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorEntry: ChatEntry = {
            type: "assistant",
            content: `Error: ${errorMessage}`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, errorEntry]);
          setIsStreaming(false);
        }

        setIsProcessing(false);
        processingStartTime.current = 0;
      };

      processInitialMessage();
    }
  }, [initialMessage, agent]);

  useEffect(() => {
    const handleConfirmationRequest = (options: ConfirmationOptions) => {
      // Batch state update to prevent flicker
      setConfirmationOptions(options);
    };

    confirmationService.on("confirmation-requested", handleConfirmationRequest);

    return () => {
      confirmationService.off(
        "confirmation-requested",
        handleConfirmationRequest,
      );
    };
  }, [confirmationService]);

  useEffect(() => {
    // Don't update processing time during confirmation to prevent flicker
    if (confirmationOptions) return;
    
    if (!isProcessing && !isStreaming) {
      setProcessingTime(0);
      return;
    }

    if (processingStartTime.current === 0) {
      processingStartTime.current = Date.now();
    }

    const interval = setInterval(() => {
      setProcessingTime(
        Math.floor((Date.now() - processingStartTime.current) / 1000),
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isProcessing, isStreaming, confirmationOptions]);

  const handleConfirmation = useCallback(
    (dontAskAgain?: boolean) => {
      // Use setTimeout to avoid state update during render
      setTimeout(() => {
        confirmationService.confirmOperation(true, dontAskAgain);
        setConfirmationOptions(null);
      }, 0);
    },
    [confirmationService],
  );

  const handleRejection = useCallback(
    (feedback?: string) => {
      // Use setTimeout to avoid state update during render
      setTimeout(() => {
        confirmationService.rejectOperation(feedback);
        setConfirmationOptions(null);

        // Reset processing states when operation is cancelled
        setIsProcessing(false);
        setIsStreaming(false);
        setTokenCount(0);
        setProcessingTime(0);
        processingStartTime.current = 0;
      }, 0);
    },
    [confirmationService],
  );

  const toggleContextTooltip = useCallback(() => {
    setShowContextTooltip((prev) => !prev);
  }, []);

  return (
    <Box flexDirection="column" paddingX={2} height="100%">
      {/* Show enhanced banner only when no chat history and no confirmation dialog */}
      {chatHistory.length === 0 && !confirmationOptions && (
        <Box flexDirection="column" marginBottom={1}>
          <Banner />
          <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="cyan">
            <Box flexDirection="column">
              <Text color="cyan" bold>
                💡 Quick Start
              </Text>
              <Box marginTop={1} flexDirection="column">
                <Text color="gray">
                  • <Text color="yellow">Ask anything:</Text> "Create a React component"
                </Text>
                <Text color="gray">
                  • <Text color="yellow">Edit files:</Text> "Add error handling to app.js"
                </Text>
                <Text color="gray">
                  • <Text color="yellow">Commands:</Text> Type "/help" for all commands
                </Text>
              </Box>

              <Box marginTop={1}>
                <Text color="cyan" bold>
                  🛠️ Power Features
                </Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <Text color="gray">
                  • <Text color="magenta">Auto-edit:</Text> Shift+Tab for hands-free editing
                </Text>
                <Text color="gray">
                  • <Text color="magenta">Context:</Text> Ctrl+I for workspace insights
                </Text>
                <Text color="gray">
                  • <Text color="magenta">Custom behavior:</Text> Create .grok/GROK.md
                </Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Chat history and confirmation dialog - freeze during confirmation */}
      <Box flexDirection="column" flexGrow={1}>
        {!confirmationOptions && (
          <Box flexDirection="column" ref={scrollRef}>
            <ChatHistory
              entries={chatHistory}
              isConfirmationActive={false}
            />
          </Box>
        )}

        {/* Context Tooltip */}
        <ContextTooltip
          isVisible={showContextTooltip}
          onToggle={toggleContextTooltip}
        />

        {/* Show confirmation dialog if one is pending - single stable render */}
        {confirmationOptions && (
          <Box flexDirection="column" key="confirmation-dialog">
            {/* Show chat history frozen in background */}
            <Box flexDirection="column">
              <ChatHistory
                entries={chatHistory}
                isConfirmationActive={true}
              />
            </Box>
            <Box marginTop={1}>
              <ConfirmationDialog
                operation={confirmationOptions.operation}
                filename={confirmationOptions.filename}
                showVSCodeOpen={confirmationOptions.showVSCodeOpen}
                content={confirmationOptions.content}
                onConfirm={handleConfirmation}
                onReject={handleRejection}
              />
            </Box>
          </Box>
        )}
      </Box>


      {/* Command suggestions overlay */}
      {/* Command suggestions overlay - disabled for now */}
      {/* {showCommandSuggestions && (
        <CommandSuggestions
          suggestions={commandSuggestions}
          selectedIndex={selectedCommandIndex}
          onSelect={handleCommandSelect}
        />
      )} */}

      {/* Model selection overlay - disabled for now */}
      {/* {showModelSelection && (
        <ModelSelection
          models={availableModels}
          selectedIndex={selectedModelIndex}
          onSelect={handleModelSelect}
        />
      )} */}

      {/* Input area - hide during confirmation to prevent flicker */}
      {!confirmationOptions && (
        <Box flexShrink={0} marginTop={1}>
          <ChatInput
            input={input || ""}
            isProcessing={isProcessing}
            isStreaming={isStreaming}
            cursorPosition={cursorPosition || 0}
          />
        </Box>
      )}

      {/* Bottom status bar - hide during confirmation to prevent flicker */}
      {!confirmationOptions && (
        <Box
          width="100%"
          flexDirection="row"
          justifyContent="space-between"
          paddingTop={1}
          paddingBottom={0.5}
          borderStyle="single"
          borderColor="gray"
        >
          <Box flexDirection="row" flexWrap="wrap">
            <Text dimColor>🧠 </Text>
            <Text dimColor>
              {tokenCount}/128000 ({Math.round((tokenCount / 128000) * 100)}%)
            </Text>
            <Text dimColor>
              {" "}
              │ 📁 {contextInfo?.workspaceFiles || 0} files │ 💬{" "}
              {chatHistory.length} msgs
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center">
            <Text dimColor>
              auto-edit: {autoEditEnabled ? "on" : "off"}
            </Text>
            <Text dimColor> │ grok-code-fast-1</Text>
            <Text dimColor> │ MCP: Ready</Text>
          </Box>
        </Box>
      )}

      {/* Show loading spinner when processing - hide during confirmation */}
      {isProcessing && !confirmationOptions && <LoadingSpinner />}
    </Box>
  );
}

// Main ChatInterface component that handles agent initialization
export function ChatInterface({
  agent: propAgent,
  initialMessage,
}: ChatInterfaceProps) {
  const [agent, setAgent] = useState<GrokAgent | null>(propAgent || null);
  const [isInitializing, setIsInitializing] = useState(!propAgent);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (!propAgent && !agent) {
      const initializeAgent = async () => {
        try {
          setIsInitializing(true);
          // Agent initialization logic would go here
          // For now, we'll just set a dummy agent
          const dummyAgent = {
            processUserMessageStream: async function* (message: string) {
              yield { type: "content", content: "Hello! I'm ready to help." };
              yield { type: "done" };
            },
          } as GrokAgent;
          setAgent(dummyAgent);
        } catch (error) {
          setApiKeyError(
            error instanceof Error
              ? error.message
              : "Failed to initialize agent",
          );
        } finally {
          setIsInitializing(false);
        }
      };

      initializeAgent();
    }
  }, [propAgent, agent]);

  if (isInitializing) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <LoadingSpinner
          operation="process"
          message="Initializing Grok CLI..."
        />
        <Text color="gray">Please wait while we set up the agent...</Text>
      </Box>
    );
  }

  if (apiKeyError) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="red" bold>
          ❌ Agent Initialization Failed
        </Text>
        <Text color="yellow">{apiKeyError}</Text>
        <ApiKeyInput onApiKeySet={() => setApiKeyError(null)} />
      </Box>
    );
  }

  if (!agent) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow" bold>
          ⚠️ No Agent Available
        </Text>
        <Text color="gray">
          Please provide an agent instance or ensure proper initialization.
        </Text>
      </Box>
    );
  }

  return (
    <ChatInterfaceWithAgent agent={agent} initialMessage={initialMessage} />
  );
}
