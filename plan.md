# Terminal Flickering Fix Plan

## Executive Summary

Welcome screen flickering caused by multi-phase initial render cascade in Ink.js components. Primary culprits: dynamic ASCII banner rendering, async context loading, and spinner animations. Fix focuses on memoization, stable layouts, and decoupled async operations.

## Root Cause Analysis

### Phase 1: Banner Mounting (Primary Flicker Source)

- **File**: `src/ui/components/banner.tsx`
- **Issue**: Complex ASCII art with dynamic sizing/centering calculations on every mount
- **Impact**: Multiple conditional styles (retro, secret, minimal) + color computations trigger layout recalcs
- **Symptoms**: ASCII blocks shift as terminal measures → Ink redraws → cursor repositions
- **Evidence**: No memoization—recomputes full banner on parent re-renders

### Phase 2: Async Context Loading (Idle/Secondary Flicker)

- **File**: `src/ui/components/chat-interface.tsx`
- **Issue**: 5+ `useEffect` hooks firing on mount with cascading state updates
- **Specific Hooks**:
  - Line 98: Input setup
  - Line 133: Welcome text generation (dynamic padding)
  - Line 153: History sync
  - Line 351: Processing state
  - Line 366: Streaming setup
- **External Dependencies**: `useContextInfo` hook loads git/workspace async → state updates → full re-render
- **Impact**: Welcome text includes dynamic margins matching Ink's `paddingX={2}` → layout shift

### Phase 3: Spinner Interference (Tool Usage Flicker)

- **File**: `src/ui/components/loading-spinner.tsx`
- **Issue**: 8 spinner configs, each with `useState` + `useEffect` for 120ms animation loop
- **Trigger**: Tool calls toggle `isStreaming`/`isProcessing` → spinner mounts/unmounts
- **Compounding Factor**: Background hooks (`use-enhanced-feedback.ts`, `use-context-info.ts`) update simultaneously
- **Why Chat Input Stable**: Pure synchronous `<TextInput>` with minimal state—no async hooks/effects

### Terminal Artifacts

- **Platform**: macOS Terminal.app (darwin) has known redraw quirks with complex Ink trees
- **Ink Behavior**: Initial measurement pass (full screen probe) conflicts with banner's absolute-like positioning
- **Layout Issue**: No fixed dimensions on root `<Box>` → dynamic resize on every state tick

## Implementation Roadmap

### Priority 1: Stabilize Banner (1-2 hours)

**Target File**: `src/ui/components/banner.tsx`

1. **Memoize ASCII Art Generation**

   ```typescript
   const MemoizedBanner = React.memo(Banner, () => true); // Skip props comparison

   // Export and use in chat-interface.tsx
   import { MemoizedBanner } from "./banner";
   ```

2. **Pre-compute Dimensions Outside Render**

   ```typescript
   // Move sizing logic to useMemo with terminal cols/rows as deps
   const bannerWidth = useMemo(() => {
     const art = generateAsciiArt(); // Your ASCII generation
     return calculateCenteredWidth(art, process.stdout.columns);
   }, []); // Empty deps - compute once

   // Use in JSX: <Box width={bannerWidth}>
   ```

3. **Static Initial Render Strategy**
   - Render plain text version first (no ASCII)
   - Swap to full ASCII after context loads (use `useEffect` with loaded state)
   - Add loading state: "Initializing Grok CLI..." → Full banner

### Priority 2: Decouple Async Loading (1 hour)

**Target File**: `src/ui/components/chat-interface.tsx`

1. **Wrap Context Hooks in Stable Effects**

   ```typescript
   // Ensure hooks only fire once on mount
   useEffect(() => {
     loadContextInfo(); // From useContextInfo
   }, []); // Empty dependency array

   // For dynamic updates, use separate effect with specific deps
   useEffect(() => {
     if (contextLoaded) {
       updateDynamicElements(); // Token count, git status
     }
   }, [contextLoaded]); // Only when context actually changes
   ```

2. **Use React's Deferred Updates**

   ```typescript
   import { useDeferredValue } from "react";

   const deferredTokenCount = useDeferredValue(tokenCount);
   // Use deferredTokenCount in UI - updates after critical renders
   ```

3. **Debounce State Setters**
   ```typescript
   // For frequent updates like processingTime
   const debouncedSetProcessingTime = useCallback(
     debounce((time: number) => setProcessingTime(time), 100),
     [],
   );
   ```

### Priority 3: Root Layout Fix (30 minutes)

**Target File**: `src/ui/app.tsx`

1. **Enforce Fixed Root Dimensions**

   ```typescript
   import { useEffect, useState } from 'react';

   function App() {
     const [dimensions, setDimensions] = useState({
       width: process.stdout.columns,
       height: process.stdout.rows - 1 // Reserve line for input
     });

     // Set once on mount, don't re-measure
     useEffect(() => {
       setDimensions({
         width: process.stdout.columns,
         height: process.stdout.rows - 1
       });
     }, []);

     return (
       <Box flexDirection="column" width={dimensions.width} height={dimensions.height}>
         {/* Your app content */}
       </Box>
     );
   }
   ```

2. **Isolate Banner Positioning**
   ```typescript
   // In chat-interface.tsx, wrap banner in fixed container
   <Box flexDirection="column" paddingX={2} paddingTop={1}>
     <Box position="relative" width="100%">
       <MemoizedBanner />
     </Box>
     {/* Rest of content */}
   </Box>
   ```

### Priority 4: Tool Usage Optimization (1 hour, post-welcome fix)

**Target Files**: `src/ui/components/loading-spinner.tsx`, `src/ui/components/chat-interface.tsx`

1. **Memoize Spinner Component**

   ```typescript
   // In loading-spinner.tsx
   const MemoizedSpinner = React.memo(LoadingSpinner, (prev, next) => {
     // Only re-render if operation or message changes
     return prev.operation === next.operation && prev.message === next.message;
   });
   ```

2. **Batch Tool State Updates**

   ```typescript
   // In chat-interface.tsx, use useTransition for non-urgent updates
   const [isPending, startTransition] = useTransition();

   // When tool state changes:
   startTransition(() => {
     setIsStreaming(true);
     setProcessingTime(0);
   });
   ```

3. **Reduce Hook Nesting**

   ```typescript
   // Extract tool activity to dedicated component
   function ToolActivityIndicator({ isStreaming, operation }) {
     // All tool-related state and effects here
     return <MemoizedSpinner operation={operation} />;
   }

   // Use in main component: <ToolActivityIndicator isStreaming={isStreaming} />
   ```

## Testing Protocol

### 1. Development Environment Setup

```bash
# Ensure clean state
rm -rf node_modules/.cache
npm run build
npm run start

# Or development mode (hot reload amplifies flicker)
bun run dev
```

### 2. Performance Metrics

- **Initial Render Time**: Should stabilize <500ms (measure with `console.time`)
- **Re-render Frequency**: Welcome screen should render once, async loads update subtly
- **Tool Flicker**: Trigger bash tool call, observe spinner stability (no full redraws)

### 3. Cross-Terminal Testing

```bash
# Test in different terminals
# iTerm2 (better Ink support)
# Terminal.app (exposes macOS quirks)
# VS Code integrated terminal
# Warp terminal (modern alternative)
```

### 4. Profiling Steps

1. Add temporary logging:

   ```typescript
   // In key components
   console.time("banner-render");
   // ... component logic
   console.timeEnd("banner-render");
   ```

2. Monitor state updates:

   ```typescript
   // In chat-interface.tsx
   useEffect(() => {
     console.log("State update:", { isProcessing, isStreaming, tokenCount });
   }, [isProcessing, isStreaming, tokenCount]);
   ```

3. Check for memory leaks:
   ```bash
   # Monitor during long sessions
   top -pid $(pgrep node)
   ```

## Success Criteria

- [ ] Welcome screen renders once without ASCII shifting
- [ ] Async context loads without layout jumps
- [ ] Tool spinners animate smoothly (no full screen redraws)
- [ ] Initial load time < 500ms
- [ ] No flicker during idle state
- [ ] Cross-terminal compatibility (iTerm2, Terminal.app)

## Risks & Mitigations

### Risk 1: Over-Memoization

- **Issue**: Stale dynamic content (git status, token count)
- **Mitigation**: Use targeted dependency arrays, not blanket memoization
- **Test**: Verify git branch updates correctly after changes

### Risk 2: Layout Breakage

- **Issue**: Fixed dimensions don't adapt to terminal resize
- **Mitigation**: Add resize listener with debounced re-measure (post-fix)
- **Test**: Resize terminal during session, verify graceful handling

### Risk 3: Performance Regression

- **Issue**: Memoization overhead > original flicker
- **Mitigation**: Profile before/after, rollback if slower
- **Test**: Measure render times with `performance.now()`

## Timeline

- **Day 1**: Priority 1 & 2 (Banner + Async) - 3 hours
- **Day 2**: Priority 3 & 4 (Layout + Tools) - 1.5 hours
- **Day 3**: Testing + Polish - 2 hours
- **Total**: ~6.5 hours

## Rollback Plan

If fixes introduce new issues:

1. Revert to original `banner.tsx` and `chat-interface.tsx`
2. Implement quick fix: Static welcome text only (no ASCII)
3. Monitor for Ink.js updates that address root causes

---

_Generated: $(date)_  
_Engineer: Senior Diagnosis Complete_  
_Status: Ready for Implementation_
